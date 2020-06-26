import * as express from 'express';
import * as moment from 'moment';
import * as request from 'request-promise';

import HC from '../glob/hc';
import * as ENV from '../glob/env';
import ERR from '../glob/err';
import { REDIS, FB } from '../glob/conn';
import _ from '../utils/_';
import ajv2 from '../utils/ajv2';

// Import models here
import { SQLDistrict } from '../models/sql/SQLDistrict';
import { SQLSamedayPricing } from '../models/sql/SQLSamedayPricing';
import { SQLPricingMisc } from '../models/sql/SQLPricingMisc';
import { IRunningOrder } from '../models/RunningOrder';
import { Endpoint } from '../models/Endpoint';

// Import services here
import AuthServ from '../serv/auth';
import { LOG } from '../serv/log';
import PromotionServ, { IPromotionContext } from '../serv/promotion';
import { User } from "../models/User";
import { SQLPromotionCodes } from "../models/sql/SQLPromotionCodes";
import { IPricingContext, PricingServ  } from '../serv/pricing';
import { ALL_ENDPOINT_TYPE } from '../glob/cf';

const router = express.Router();
const _ajv = ajv2();

// truongpn
const pricingSameDayBody = _ajv({
    '+@from_district': 'number|>0',
    '+@to_district': 'number|>0',
    '+@fragile': 'boolean',
    '+@weight': 'number|>=0',
    '+@exceed_size': 'integer|>=0',
    '+@COD': 'number|>=0',
    '+@order_id': 'string',
    '+@endpoint_id': 'string',
    '+is_document': {enum: [true, false]},
    '++': false
});
router.post('/endpoint/sameday', _.validBody(pricingSameDayBody), _.routeAsync(async (req) => {
    
    let totalFee = 0;
    const driver_id = req.header('userid');
    // Check driver
    const driver = await FB.get<User>(`winders/${driver_id}`);
    if (_.isEmpty(driver)){
        throw _.logicError('Could not find driver', `Driver ${driver_id} not found`, 400, ERR.OBJECT_NOT_FOUND, driver_id);
    }
    // Check order
    const orderRuning = await FB.get<IRunningOrder>(`running_orders/${req.body.order_id}`);
    if (_.isEmpty(orderRuning)){
        throw _.logicError('Could not find order', `Order ${req.body.order_id} not found`, 400, ERR.OBJECT_NOT_FOUND, req.body.order_id);
    }

    const pricingCtx: IPricingContext = {
        from_district: req.body.from_district,
        to_district: req.body.to_district,
        weight: req.body.weight,
        fragile: req.body.fragile,
        is_document: req.body.is_document,
        COD: req.body.COD
    }

    const delivFee = await PricingServ.calcPricing(pricingCtx);

    // Promotion code
    const user_id = orderRuning.user_id;
    let decrease_amount: number = 0;

    const code: string = await FB.get<string>(`promotion-code-with-order/${req.body.order_id}/code_promotion`) || null;
    const context = {
        user_id: orderRuning.user_id,
        endpoint_id: req.body.endpoint_id
    }
    const codePromotion = await PromotionServ.getCodeIfAvailable(code, context);
    console.log('---promotion code------');
    console.log(codePromotion);
    let rewards;
    if (!_.isEmpty(codePromotion)) {
        rewards = JSON.parse(codePromotion.rewards);
        decrease_amount = await PromotionServ.reward(delivFee, rewards);
    }

    LOG.logAction(parseInt(req.header('userid')), 'TINH_PHI', {id: req.body.endpoint_id, name: 'endpoint'}, { deliv_fee: delivFee, decrease_amount: decrease_amount, rewards: rewards });

    return {
        deliv_fee: delivFee,
        decrease_amount: decrease_amount
    };
}));

router.post('/order/:order_id', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const order_id = req.params.order_id;
    const driver_id = parseInt(req.header('userid'));

    const runningOrder = await FB.get<IRunningOrder>(`running_orders/${order_id}`);
    if (_.isEmpty(runningOrder)) {
        throw _.logicError('Could not find running order', `Running order ${order_id} not found`, 400, ERR.OBJECT_NOT_FOUND, order_id);
    }

    const order: any = await FB.get(`winders/${driver_id}/orders/${order_id}`);

    if (_.isEmpty(order)) {
        throw _.logicError('Could not find driver fit order', `Driver ${driver_id} not found fit order ${order_id}`, 400, ERR.OBJECT_NOT_FOUND, driver_id, order_id);
    }

    if (order.type != "0" && order.type != 0){
        throw _.logicError('Running order not on-demand', `Running order ${order_id} not on-demand`, 400, ERR.INVALID_TYPE, order_id);        
    }

    let kmOndemand = 0;

    const endpoints: Endpoint[]  = _.values(order.endpoints).map(Endpoint.fromJSON);
    for (var i = 1; i <= endpoints.length; i++){
        const from_lng = endpoints[i-1].lng;
        const from_lat = endpoints[i-1].lat;

        const to_lng = endpoints[i].lng;
        const to_lat = endpoints[i].lat;

        const result = await request(`${ENV.host_osrm}/route/v1/driving/${from_lng},${from_lat};${to_lng},${to_lat}`, {
            method: 'GET',
            json: true
        });
        const distance = result.routes[0].distance/1000;
        kmOndemand = kmOndemand + distance;
    }

    const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
    const KM_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_ONDEMAND'}).value);
    const kmFee = kmOndemand * KM_PRICING_ONDEMAND;

    const orderCurrentCost = await FB.get<number>(`winders/${runningOrder.winder_id}/orders/${runningOrder.order_id}/total_delivery_fee`);
    const orderCost = orderCurrentCost + kmFee;
    await Promise.all([
        FB.ref(`winders/${runningOrder.winder_id}/orders/${runningOrder.order_id}/total_delivery_fee`).set(orderCost),
        FB.ref(`users/${runningOrder.user_id}/orders/${runningOrder.order_id}/total_delivery_fee`).set(orderCost)
    ]);

    LOG.logAction(parseInt(req.header('userid')), 'TINH_PHI_ORDER_ONDEMAND', { id: order_id, name: '' }, { orderCost:  orderCost });  

    return HC.SUCCESS
}));

router.get('/configs', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const configs = await SQLPricingMisc.findAll<SQLPricingMisc>();
    return configs;
}));

const pricingSameDayTempBody = _ajv({
    '+@from_district': 'number|>0',
    '+to_districts': {
        'type': 'array',
        '@items':{
            '+@id': 'number|>0',
            '+@to_district': 'number|>0',
            '++': false
        },
        'minItems': 1
    },
    '+@promotion_code': 'string',
    '++': false
});
router.post('/type/sameday/tmp', _.validBody(pricingSameDayTempBody), _.routeAsync(async (req) => {
    
    let totalFee = 0;
    const user_id: number = parseInt(req.header('userid'));
    // Check user
    const user = await FB.get<User>(`users/${user_id}`);
    if (_.isEmpty(user)){
        throw _.logicError('Could not find user', `User ${user_id} not found`, 400, ERR.OBJECT_NOT_FOUND, user_id);
    }

    const code: string = req.body.promotion_code.toUpperCase();
    const context: IPromotionContext = {
        user_id: user_id,
        endpoint_id: null
    }
    const codePromotion = await PromotionServ.getCodeIfAvailable(code, context);
    const listPricing = [];
    const listDistrict = req.body.to_districts;
    for(let i = 0; i < listDistrict.length; i++){
        const toDistrict: number = listDistrict[i].to_district;
        let decrease_amount: number = 0;
        const pricingCtx: IPricingContext = {
            from_district: req.body.from_district,
            to_district: toDistrict,
            weight: 0,
            fragile: false,
            is_document: 0,
            COD: 0
        }
        const delivFee = await PricingServ.calcPricing(pricingCtx);
        // Promotion code
        if (!_.isEmpty(codePromotion)) {
            const rewards = JSON.parse(codePromotion.rewards);
            decrease_amount = await PromotionServ.reward(delivFee, rewards);
        }
        listPricing.push({id: listDistrict[i].id, decrease_fee: decrease_amount, deliv_fee: delivFee});
    }

    LOG.logAction(parseInt(req.header('userid')), 'TINH_PHI', {id: '', name: 'endpoint'}, { listPricing: listPricing });

    return listPricing;
}));

const pricingBuyForMeTempBody = _ajv({
    '+endpoints': {
        'type': 'array',
        '@items':{
            '+type': {enum: [0, 1]},            
            '+@address': 'string|len>0',
            '+@lat': 'number|>=-90|<=90',
            '+@lng': 'number|>=-180|<=180',
            '++': false
        },
        'minItems': 2
    },
    '+@promotion_code': 'string',
    '++': false
});
router.post('/type/buy-for-me/tmp', _.validBody(pricingBuyForMeTempBody), _.routeAsync(async (req) => {
    
    let totalFee = 0;
    const user_id: number = parseInt(req.header('userid'));
    // Check user
    const user = await FB.get<User>(`users/${user_id}`);
    if (_.isEmpty(user)){
        throw _.logicError('Could not find user', `User ${user_id} not found`, 400, ERR.OBJECT_NOT_FOUND, user_id);
    }

    const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
    const BASE_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'BASE_PRICING_ONDEMAND'}).value);
    const ENDPOINT_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'ENDPOINT_PRICING_ONDEMAND'}).value);
    const KM_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_ONDEMAND'}).value);

    const endpoints: any[] = req.body.endpoints;
    const pickups: any[] = _.filter(endpoints, { "type": ALL_ENDPOINT_TYPE.PICKUP })
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
    totalFee = pickups.length * ENDPOINT_PRICING_ONDEMAND + totalKm * KM_PRICING_ONDEMAND;

    const code: string = req.body.promotion_code.toUpperCase();
    const context: IPromotionContext = {
        user_id: user_id,
        endpoint_id: null
    }
    const codePromotion = await PromotionServ.getCodeIfAvailable(code, context);
    let decrease_amount = 0;
    if (!_.isEmpty(codePromotion)) {
        const rewards = JSON.parse(codePromotion.rewards);
        decrease_amount = await PromotionServ.reward(totalFee, rewards);
    }
    LOG.logAction(parseInt(req.header('userid')), 'TINH_PHI', {id: '', name: 'endpoint'}, { deliv_fee: totalFee, decrease_amount: decrease_amount});

    return {
        deliv_fee: totalFee,
        decrease_amount: decrease_amount
    };;
}));

const pricingDeliNTempBody = _ajv({
    '+endpoints': {
        'type': 'array',
        '@items':{
            '+type': {enum: [0, 1]},            
            '+@address': 'string|len>0',
            '+@lat': 'number|>=-90|<=90',
            '+@lng': 'number|>=-180|<=180',
            '@note': 'string',
            '++': false
        },
        'minItems': 2
    },
    '+@promotion_code': 'string',
    '++': false
});
router.post('/type/deliver-now/tmp', _.validBody(pricingDeliNTempBody), _.routeAsync(async (req) => {
    let totalFee = 0;
    const user_id: number = parseInt(req.header('userid'));
    // Check user
    const user = await FB.get<User>(`users/${user_id}`);
    if (_.isEmpty(user)){
        throw _.logicError('Could not find user', `User ${user_id} not found`, 400, ERR.OBJECT_NOT_FOUND, user_id);
    }

    const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
    const KM_LIMIT_DELIN = parseInt(_.find(pricingMisc, {'field': 'KM_LIMIT_DELIN'}).value);
    const KM_PRICING_LIMIT_DELIN = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_LIMIT_DELIN'}).value);
    const KM_PRICING_DELIN = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_DELIN'}).value);
    const ENDPOINT_PRICING_DELIN = parseInt(_.find(pricingMisc, {'field': 'ENDPOINT_PRICING_DELIN'}).value);

    const endpoints: any[] = req.body.endpoints;
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
    totalFee = kmFee + endpointFee;
    
    const code: string = req.body.promotion_code.toUpperCase();
    const context: IPromotionContext = {
        user_id: user_id,
        endpoint_id: null
    }
    const codePromotion = await PromotionServ.getCodeIfAvailable(code, context);
    let decrease_amount = 0;
    if (!_.isEmpty(codePromotion)) {
        const rewards = JSON.parse(codePromotion.rewards);
        decrease_amount = await PromotionServ.reward(totalFee, rewards);
    }
    
    LOG.logAction(parseInt(req.header('userid')), 'TINH_PHI', {id: '', name: 'endpoint'}, { deliv_fee: totalFee, decrease_amount: decrease_amount});

    return {
        deliv_fee: totalFee,
        decrease_amount: decrease_amount
    };;
}));

router.get('/type/deliver-now/totalKm/:totalKm/totalPlace/:totalPlace', _.routeAsync(async (req) => {
    const totalKm: number = req.params.totalKm;
    const totalPlace: number = req.params.totalPlace;

    const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
    const KM_LIMIT_DELIN = parseInt(_.find(pricingMisc, {'field': 'KM_LIMIT_DELIN'}).value);
    const KM_PRICING_LIMIT_DELIN = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_LIMIT_DELIN'}).value);
    const KM_PRICING_DELIN = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_DELIN'}).value);
    const ENDPOINT_PRICING_DELIN = parseInt(_.find(pricingMisc, {'field': 'ENDPOINT_PRICING_DELIN'}).value);

    const kmFee = KM_PRICING_LIMIT_DELIN + Math.max(totalKm - KM_LIMIT_DELIN, 0) * KM_PRICING_DELIN;
    const totalFee = ENDPOINT_PRICING_DELIN * totalPlace;

    return {
        kmFee: kmFee,
        kmPrice: KM_PRICING_DELIN,
        totalFee: totalFee,
        endpointPrice: ENDPOINT_PRICING_DELIN
    }
}));

router.get('/type/buy-for-me/totalKm/:totalKm/totalPlace/:totalPlace', _.routeAsync(async (req) => {
    const totalKm: number = req.params.totalKm;
    const totalPlace: number = req.params.totalPlace;

    const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
    const ENDPOINT_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'ENDPOINT_PRICING_ONDEMAND'}).value);
    const KM_PRICING_ONDEMAND = parseInt(_.find(pricingMisc, {'field': 'KM_PRICING_ONDEMAND'}).value);

    const kmFee = totalKm * KM_PRICING_ONDEMAND;
    const totalFee = totalPlace * ENDPOINT_PRICING_ONDEMAND;

    return {
        kmFee: kmFee,
        kmPrice: KM_PRICING_ONDEMAND,
        totalFee: totalFee,
        endpointPrice: ENDPOINT_PRICING_ONDEMAND
    }
}));

export default router;