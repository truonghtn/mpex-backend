import * as moment from 'moment';
import * as bases from 'bases';
import * as pad from 'string-padding';
import * as request from 'request-promise';

import * as CF from '../glob/cf';
import * as ENV from '../glob/env';
import HC from '../glob/hc';
import { REDIS, FB } from '../glob/conn';
import _ from '../utils/_';
import { QPR } from '../utils/qpr';

import { Endpoint } from '../models/Endpoint';
import { IRunningOrder } from '../models/RunningOrder';
import { Tracking } from '../models/Tracking';
import { SQLPricingMisc } from '../models/sql/SQLPricingMisc';

import { IPromotionContext, PromotionServ } from './promotion';
import { Order } from '../models/Order';
import { ALL_ENDPOINT_TYPE, ALL_ONDEMAND_TYPE, ONDEMAND_TYPE, REQUEST_TYPE_ON_DEMAND, REQUEST_TYPE_SAMEDAY } from '../glob/cf';

export interface IAddEndpointContext {
    runningOrder: IRunningOrder;
    order: any;
    endpoint: Endpoint;
}

export class EndpointServ {
    static readonly QPRPrime = QPR.findQPRPrime(34000000);
    static readonly DAY_XOR = 10946503;

    static async genEndpointCode() {
        const todayNum = moment().diff(HC.BEGIN_DATE, 'd');
        const todayCode = bases.toAlphabet(todayNum, HC.HUMAN32_ALPHABET);
        const todayXOR = QPR.generate(todayNum, this.QPRPrime, this.DAY_XOR);
        const redisKey = `mp:code:${todayCode}`;
        const codeInNumber: number = await REDIS.incr(redisKey);
        const code = bases.toAlphabet(QPR.generate(codeInNumber, this.QPRPrime, todayXOR), HC.HUMAN32_ALPHABET);
        return `MX${pad(todayCode, 3, '0')}${pad(code, 5, '0')}`;
    }

    static async genEndpointId() {
        const todayId = bases.toAlphabet(moment().diff(HC.BEGIN_DATE, 'd'), HC.HUMAN32_ALPHABET);
        const redisKey = `mp:epcode:${todayId}`;
        const IdInNumber: number = await REDIS.incr(redisKey);
        return `E${pad(todayId, 3, '0')}${IdInNumber}`;
    }

    static async pricingBuyMeEndpoint(ctx: IAddEndpointContext) {
        const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
        const BASE_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'BASE_PRICING_ONDEMAND'}).value);
        const ENDPOINT_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'ENDPOINT_PRICING_ONDEMAND'}).value);
        const KM_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_ONDEMAND'}).value);

        const endpoints: Endpoint[] = (_.values(ctx.order.endpoints) || []).map(Endpoint.fromJSON);

        const pickups: Endpoint[] = _.filter(endpoints, { "type": ALL_ENDPOINT_TYPE.PICKUP })
        const dropoff: Endpoint = _.find(endpoints, { "type": ALL_ENDPOINT_TYPE.DROPOFF })
        let totalKm = 0;
        for(let i = 0; i < pickups.length; i++){
            const from_lng = pickups[i].lng;
            const from_lat = pickups[i].lat;
            let to_lng = 0;
            let to_lat = 0
            if (i < pickups.length - 1) {
                to_lng = pickups[i + 1].lng;
                to_lat = pickups[i + 1].lat;
            } else {
                to_lng = dropoff.lng;
                to_lat = dropoff.lat;
            }
    
            const result = await request(`${ENV.host_osrm}/route/v1/driving/${from_lng},${from_lat};${to_lng},${to_lat}`, {
                method: 'GET',
                json: true
            });
            totalKm += Math.ceil(result.routes[0].distance / 1000);   
        }
       
        const orgCost = pickups.length * ENDPOINT_PRICING_ONDEMAND + totalKm * KM_PRICING_ONDEMAND;
        // Mã khuyến mãi
        const code = await FB.get<string>(`promotion-code-with-order/${ctx.runningOrder.order_id}/code_promotion`);
        const prContext: IPromotionContext = {
            user_id: ctx.runningOrder.user_id,
            endpoint_id: ctx.runningOrder.order_id
        }
        const promotionCode = await PromotionServ.getCodeIfAvailable(code, prContext);
        let promotedAmount = 0;
        if (!_.isEmpty(promotionCode)) {
            const rewards = JSON.parse(promotionCode.rewards);
            promotedAmount = await PromotionServ.reward(orgCost, rewards);
        }

        const orderCost = Math.max(orgCost - promotedAmount, 0);

        await Promise.all([
            FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/total_delivery_fee`).set(orderCost),
            FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/total_delivery_fee`).set(orderCost),

            FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/total_km`).set(totalKm),
            FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/total_km`).set(totalKm)
        ]);

        if (!_.isEmpty(promotionCode)) {
            await PromotionServ.recordUsage(promotionCode, prContext);
        }
    }


    static async pricingDelivNowEndpoint(ctx: IAddEndpointContext) {
        const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
        const KM_LIMIT_DELIN = parseInt(_.find(pricingMisc, {'field': 'KM_LIMIT_DELIN'}).value);
        const KM_PRICING_LIMIT_DELIN = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_LIMIT_DELIN'}).value);
        const KM_PRICING_DELIN = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_DELIN'}).value);
        const ENDPOINT_PRICING_DELIN = parseInt(_.find(pricingMisc, {'field': 'ENDPOINT_PRICING_DELIN'}).value);

        const endpoints: Endpoint[] = (_.values(ctx.order.endpoints) || []).map(Endpoint.fromJSON);
        let totalKm = 0;
        for(let i = 0; i < endpoints.length - 1; i++){
            const from_lng = endpoints[i].lng;
            const from_lat = endpoints[i].lat;
    
            const to_lng = endpoints[i + 1].lng;
            const to_lat = endpoints[i + 1].lat;
    
            const result = await request(`${ENV.host_osrm}/route/v1/driving/${from_lng},${from_lat};${to_lng},${to_lat}`, {
                method: 'GET',
                json: true
            });
            totalKm += Math.ceil(result.routes[0].distance / 1000);   
        }
        const kmFee = KM_PRICING_LIMIT_DELIN + Math.max(totalKm - KM_LIMIT_DELIN, 0) * KM_PRICING_DELIN;
        const endpointFee = ENDPOINT_PRICING_DELIN * (endpoints.length - 2);
        const orgCost = kmFee + endpointFee;

        // Mã khuyến mãi
        const code = await FB.get<string>(`promotion-code-with-order/${ctx.runningOrder.order_id}/code_promotion`);
        const prContext: IPromotionContext = {
            user_id: ctx.runningOrder.user_id,
            endpoint_id: ctx.runningOrder.order_id
        }
        console.log(`promotion code: ${code}`);
        const promotionCode = await PromotionServ.getCodeIfAvailable(code, prContext);
        let promotedAmount = 0;
        if (!_.isEmpty(promotionCode)) {
            const rewards = JSON.parse(promotionCode.rewards);
            promotedAmount = await PromotionServ.reward(orgCost, rewards);
        }

        const orderCost = Math.max(orgCost - promotedAmount, 0);

        await Promise.all([
            FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/total_delivery_fee`).set(orderCost),
            FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/total_delivery_fee`).set(orderCost),

            FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/total_km`).set(totalKm),
            FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/total_km`).set(totalKm)
        ]);

        if (!_.isEmpty(promotionCode)) {
            await PromotionServ.recordUsage(promotionCode, prContext);
        }
    }

    static async pricingSameDayEndpoint(ctx: IAddEndpointContext) {
        const orderCost = ctx.order.total_delivery_fee + ctx.endpoint.deliv_fee || 0;
        await Promise.all([
            FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/total_delivery_fee`).set(orderCost),
            FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/total_delivery_fee`).set(orderCost)
        ]);
    
        // Ghi nhận dùng mã khuyến mãi
        const code = await FB.get<string>(`promotion-code-with-order/${ctx.runningOrder.order_id}/code_promotion`);
        const prCtx: IPromotionContext = {
            user_id: ctx.runningOrder.user_id,
            endpoint_id: ctx.endpoint.id
        }
        const promotionCode = await PromotionServ.getCodeIfAvailable(code, prCtx);
        if (!_.isEmpty(promotionCode)) {
            await PromotionServ.recordUsage(promotionCode, prCtx);
        }
    }

    static async addEndpointAndTrackingToFirebase(ctx: IAddEndpointContext) {
        // Tính phí ondemand
        const tracking = new Tracking({
            driver_id: ctx.runningOrder.winder_id,
            user_id: ctx.order.user_id,
            order_id: ctx.runningOrder.order_id,
            endpoint_id: ctx.endpoint.id,
            status: CF.ALL_ENDPOINT_STATUSES.DELIVERING
        });
        const endpoints: Endpoint[] = _.values(await FB.get(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/endpoints`)).map(Endpoint.fromJSON);
        const order: Order = await FB.get<Order>(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}`);  
        if (order.type_request == REQUEST_TYPE_ON_DEMAND && order.type_ondemand == CF.ALL_ONDEMAND_TYPE.BFM) {
            if (ctx.endpoint.type == ALL_ENDPOINT_TYPE.DROPOFF){
                endpoints.push(ctx.endpoint);
                await Promise.all([
                    FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/endpoints/${ctx.endpoint.id}`).set(ctx.endpoint.toJSON()),
                    FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/endpoints/${ctx.endpoint.id}`).set(ctx.endpoint.toJSON())
                ]);
            }
            if (ctx.endpoint.type == ALL_ENDPOINT_TYPE.PICKUP){
                const endpointDropoff: Endpoint = endpoints.find(e => e.type == ALL_ENDPOINT_TYPE.DROPOFF);
                // Xoa endpoint dropoff
                await Promise.all([
                    FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/endpoints/${endpointDropoff.id}`).remove(),
                    FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/endpoints/${endpointDropoff.id}`).remove()
                ]);
                // Add endpoint moi
                await Promise.all([
                    FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/endpoints/${ctx.endpoint.id}`).set(ctx.endpoint.toJSON()),
                    FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/endpoints/${ctx.endpoint.id}`).set(ctx.endpoint.toJSON())
                ]);
                // Add endpoint dropoff
                await Promise.all([
                    FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/endpoints/${endpointDropoff.id}`).set(endpointDropoff.toJSON()),
                    FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/endpoints/${endpointDropoff.id}`).set(endpointDropoff.toJSON())
                ]);
            }
            await FB.ref(`tracking_endpoints/${ctx.endpoint.endpoint_code}`).set(tracking.toJSON());
        }
        if (order.type_request == REQUEST_TYPE_ON_DEMAND && order.type_ondemand == CF.ALL_ONDEMAND_TYPE.DN) {
            await Promise.all([
                FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/endpoints/${ctx.endpoint.id}`).set(ctx.endpoint.toJSON()),
                FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/endpoints/${ctx.endpoint.id}`).set(ctx.endpoint.toJSON()),
                FB.ref(`tracking_endpoints/${ctx.endpoint.endpoint_code}`).set(tracking.toJSON())
            ]);
        }
        if (order.type_request == REQUEST_TYPE_SAMEDAY) {
            if (ctx.endpoint.type == CF.ALL_ENDPOINT_TYPE.DROPOFF){
                console.log('1');
                await Promise.all([
                    FB.ref(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}/endpoints/${ctx.endpoint.id}`).set(ctx.endpoint.toJSON()),
                    FB.ref(`users/${ctx.runningOrder.user_id}/orders/${ctx.runningOrder.order_id}/endpoints/${ctx.endpoint.id}`).set(ctx.endpoint.toJSON()),
                    FB.ref(`tracking_endpoints/${ctx.endpoint.endpoint_code}`).set(tracking.toJSON())
                ]);
            }
        }
        const result: Order = await FB.get<Order>(`winders/${ctx.runningOrder.winder_id}/orders/${ctx.runningOrder.order_id}`, Order.fromJSON);   
        return result;     
    }

    static async addEndpointFromMobile(endpoint: Endpoint, order: Order, runningOrder: IRunningOrder) {
        const requestType = _.parseIntNull(order.type_request);
        const ondemandType: ONDEMAND_TYPE = order.type_ondemand;
        const context = {
            runningOrder: runningOrder,
            order: order,
            endpoint: endpoint
        };
        await this.addEndpointAndTrackingToFirebase(context);
        if (requestType == CF.REQUEST_TYPE_ON_DEMAND) {
            const newOrder: Order = await FB.get<Order>(`winders/${runningOrder.winder_id}/orders/${runningOrder.order_id}`);     
            context.order = newOrder;
            if (ondemandType == ALL_ONDEMAND_TYPE.BFM) {
                await EndpointServ.pricingBuyMeEndpoint(context);                
            }
            if (ondemandType == ALL_ONDEMAND_TYPE.DN) {
                await EndpointServ.pricingDelivNowEndpoint(context); 
            }
        }
        else {
            await EndpointServ.pricingSameDayEndpoint(context);
        }
    }
}

export default EndpointServ;