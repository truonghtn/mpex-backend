import * as moment from 'moment';
import * as bases from 'bases';
import * as pad from 'string-padding';

import HC from '../glob/hc';
import { REDIS, FB } from '../glob/conn';
import _ from '../utils/_';
import { SQLPricingMisc } from '../models/sql/SQLPricingMisc';

export class OrderServ {
    static async genOrderId() {
        const todayId = bases.toAlphabet(moment().diff(HC.BEGIN_DATE, 'd'), HC.HUMAN32_ALPHABET);
        const redisKey = `mp:orderCode:${todayId}`;
        const IdInNumber: number = await REDIS.incr(redisKey);
        return `O${pad(todayId, 3, '0')}${IdInNumber}`;
    }

    static async pricingOndemand(totalKM: number, totalEndpoint: number) {
        const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
        const BASE_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'BASE_PRICING_ONDEMAND'}).value);
        const ENDPOINT_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'ENDPOINT_PRICING_ONDEMAND'}).value);
        const KM_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_ONDEMAND'}).value);

        return BASE_PRICING_ONDEMAND + totalKM * KM_PRICING_ONDEMAND + totalEndpoint * ENDPOINT_PRICING_ONDEMAND;
    }

    static async acceptedOrder(driverId: number, order: any){
        const driver = (await FB.ref(`winders/${driverId}`).once('value')).val();
        await FB.ref('pool/' + order.order_id + '/status/winder').set(driverId);
        const defaultData = {
            user_id: parseInt(order.user_id),
            order_code: order.order_code,
            order_lat: order.order_lat,
            order_lng: order.order_lng,
            order_address: order.order_address,
            type_request: order.type_request,
            type_ondemand: order.type_ondemand,
            order_districts: (typeof order.order_districts != 'undefined') ? order.order_districts : null,
            total_km: 0,
            total_delivery_fee: 0,
            created_at: order.created_at,
            endpoints: order.endpoints != undefined ? order.endpoints : null,
            updated_at: moment().format(HC.DATETIME_FMT),
            status: 8
        };

        const userOrderData = _.merge(defaultData, {
            winder_info: {
                winder_id: driverId,
                winder_name: driver.first_name,
                winder_phone: driver.phone,
                winder_avatar: (typeof driver.avatar != 'undefined') ? driver.avatar :'',
                winder_group: (typeof driver.group_name != 'undefined') ? driver.group_name :'',
                winder_rating: isNaN(parseFloat(driver.rating)) ? 0 : parseFloat(driver.rating),
                winder_distance_accumulation: (typeof driver.distance_accumulation != 'undefined') ? parseFloat(driver.distance_accumulation) : 0,
                facebook_id: (typeof driver.facebook_id != 'undefined') ? driver.facebook_id :''
            }
        });
        await Promise.all([
            FB.ref('users/' + order.user_id + '/orders/' + order.order_id).set(userOrderData),
            FB.ref('winders/' + driverId + '/orders/' + order.order_id).set(defaultData),
            FB.ref(`running_orders/${order.order_id}`).set({
                order_id: order.order_id,
                winder_id: driverId,
                user_id: defaultData.user_id
            }),
            FB.ref("pool/" + order.order_id).remove()
        ]);
    }
}

export default OrderServ;