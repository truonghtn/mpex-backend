import * as express from 'express';
import * as moment from 'moment';
import * as uuid from 'uuid';
import * as lodash from 'lodash';
import * as shortid from 'shortid';
import * as Redlock from 'redlock';
import * as redis from 'redis';

import HC from '../glob/hc';
import * as CF from '../glob/cf';
import ERR from '../glob/err';
import { REDIS, FB } from '../glob/conn';
import _ from '../utils/_';
import ajv2 from '../utils/ajv2';

// Import models here
import { User } from '../models/User';
import { IRunningOrder } from '../models/RunningOrder';
import { SQLOrder } from '../models/sql/SQLOrder';
import { SQLPromotionCodes } from '../models/sql/SQLPromotionCodes';
import { Endpoint } from '../models/Endpoint';

// Import services here
import AuthServ from '../serv/auth';
import OrderServ from '../serv/order';
import PromoServ, { IPromotionContext, PromotionServ } from '../serv/promotion';
import LockServ from '../serv/lock';
import { LOG } from '../serv/log';
import { PromotionStrategy, PromotionByPercent, PromotionDetermined } from "../models/PromotionCode";
import { REQUEST_TYPE_SAMEDAY, REQUEST_TYPE_ON_DEMAND, ALL_ENDPOINT_STATUSES, ALL_ONDEMAND_TYPE } from '../glob/cf';
import { AccountantServ } from '../serv/accountant';
import { SQLUser } from '../models/sql/SQLUser';
import { SQLTempOrder } from '../models/sql/SQLTempndpoints';
import { EndpointServ } from '../serv/endpoint';
import { Order } from '../models/Order';
import { SQLDistrict } from '../models/sql/SQLDistrict';
import { PricingServ, IPricingContext } from '../serv/pricing';

const router = express.Router();
const _ajv = ajv2();
const lock = new LockServ();

const redlock = new Redlock([redis.createClient()]);

router.get('/id', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    return {
        code: await OrderServ.genOrderId()
    };
}));
const addOrderBody = _ajv({
    '+@order_address': 'string',
    '+@order_lat': 'number|>=-90|<=90',
    '+@order_lng': 'number|>=-180|<=180',
    '+type_request': { enum: [CF.REQUEST_TYPE_SAMEDAY, CF.REQUEST_TYPE_ON_DEMAND] },
    '+ondemand_type': { enum: ["DN", "BFM", "DS"] },
    'endpoints': {
        'type': 'array',
        '@items': {
            '@address': 'string',
            '+type': { enum: [0, 1] },
            '@district': 'number|>0',
            '@lat': 'number|>=-90|<=90',
            '@lng': 'number|>=-180|<=180',
            '@customer_note': 'string',
            '@note': 'string',
            '++': false
        }
    },
    '@code_promotion': 'string',
    '++': false
});
router.post('/', _.validBody(addOrderBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const userId: number = parseInt(req.header('userid'));
    const userSnap = await FB.getSnapshot(`users/${userId}`);
    if (!userSnap.exists()) {
        throw _.logicError('User not exist', `Could not find user with id ${userId}`, 400, ERR.OBJECT_NOT_FOUND, userId);
    }

    const user = new User(userSnap.val());
    if (!_.isEmpty(user.orders)) {
        throw _.logicError('Cannot add order', `User is already has an order`, 400, ERR.USER_ALREADY_HAS_ORDER);
    }

    const orderId = await OrderServ.genOrderId();

    const code = (req.body.code_promotion && req.body.code_promotion).toUpperCase();
    if (!_.isEmpty(code)) {
        const context: IPromotionContext = {
            user_id: userId,
            endpoint_id: null
        }

        const codePromotion = await PromoServ.getCodeIfAvailable(code, context);
        if (!_.isEmpty(codePromotion)) {
            await FB.ref(`promotion-code-with-order/${orderId}`).set({
                order_id: orderId,
                code_promotion: code
            });
        }
    }

    // Lưu endpoints tạm 
    const tempEndpoints: Endpoint[] = req.body.endpoints;
    // Tao bien endpoints nay lam cqq gi v ?
    const endpoints = tempEndpoints.map(async e => {
        e.id = await EndpointServ.genEndpointId();
        e.endpoint_code = await EndpointServ.genEndpointCode();
        e.order_id = orderId;
        e.org_order_id = orderId;
        e.created_at = moment().format(HC.DATETIME_FMT),
            e.updated_at = moment().format(HC.DATETIME_FMT),
            e.status = ALL_ENDPOINT_STATUSES.NONE
    })
    await SQLTempOrder.create<SQLTempOrder>({
        id: orderId,
        content: JSON.stringify(tempEndpoints)
    });

    const addOrderTask: any = {
        order_id: orderId,
        order_code: orderId,
        order_address: req.body.order_address,
        order_lat: req.body.order_lat,
        order_lng: req.body.order_lng,
        user_id: userId,
        type_request: req.body.type_request,
        type_ondemand: req.body.ondemand_type
    };

    const districtIds: number[] = tempEndpoints.map(e => <any>e.district);
    if (!_.isEmpty(districtIds)) {
        const districts = await SQLDistrict.findAll<SQLDistrict>({ where: { id: districtIds } });
        addOrderTask.order_districts = districts.map(d => d.name);
    }

    if (!_.isEmpty(req.body.order_districts)) {
    }

    await FB.ref(`queue-nearest/tasks`).push(addOrderTask);

    LOG.logAction(parseInt(req.header('userid')), 'TAO_MOI_BOOKING', { id: orderId, name: '' }, { order: addOrderTask, code_promotion: code });

    return { order_id: orderId };
}));

// truongpn
const completeOrderBody = _ajv({
    '+@driver_id': 'integer|>0',
    '+@user_id': 'integer|>0',
    '+@forced': 'boolean',
    '++': false
});
router.post('/complete/:id', _.validBody(completeOrderBody), _.routeAsync(async (req) => {
    const driver_id = parseInt(req.body.driver_id);
    const user_id = parseInt(req.body.user_id);
    const order_id = req.params.id;
    const is_forced = req.body.forced;

    // Check order
    const orderRuning = await FB.get<IRunningOrder>(`running_orders/${order_id}`);
    if (_.isEmpty(orderRuning)) {
        throw _.logicError('Could not find order', `Order ${order_id} not found`, 400, ERR.OBJECT_NOT_FOUND, order_id);
    }
    // Check winder
    if (orderRuning.winder_id == undefined || orderRuning.winder_id != driver_id) {
        throw _.logicError('Could not find driver', `Driver ${driver_id} not found`, 400, ERR.OBJECT_NOT_FOUND, driver_id);
    }
    // Check user
    if (orderRuning.user_id == undefined || orderRuning.user_id != user_id) {
        throw _.logicError('Could not find user', `User ${user_id} not found`, 400, ERR.OBJECT_NOT_FOUND, user_id);
    }

    const endpoints: Endpoint[] = _.values(await FB.get(`winders/${orderRuning.winder_id}/orders/${orderRuning.order_id}/endpoints`)).map(Endpoint.fromJSON);
    const endpointWHS = endpoints.find(e => e.status == CF.ALL_ENDPOINT_STATUSES.WAREHOUSING && e.order_id == e.org_order_id);

    const dataPush = {
        winder_id: driver_id,
        user_id: user_id,
        order_id: order_id,
        is_forced: is_forced
    }

    if (!_.isEmpty(endpointWHS)) {
        // Update status order is on-hold
        await Promise.all([
            FB.ref(`users/${orderRuning.user_id}/orders/${orderRuning.order_id}/status`).set(CF.ALL_ORDER_STATUSES.ON_HOLD),
            FB.ref(`winders/${orderRuning.winder_id}/orders/${orderRuning.order_id}/status`).set(CF.ALL_ORDER_STATUSES.ON_HOLD)
        ])
    } else {
        const endpoints: Endpoint[] = _.values(await FB.get(`winders/${orderRuning.winder_id}/orders/${orderRuning.order_id}/endpoints`)).map(Endpoint.fromJSON);
        //Tracking endpoints
        endpoints.forEach(async e => {
            if (e.org_order_id == orderRuning.order_id) {
                await FB.ref(`tracking_endpoints/${e.endpoint_code}`).remove();
            }
        })
        // Chia tiền cho shipper ondemand
        let shipTransactions = [];
        const order: any = await FB.get(`winders/${orderRuning.winder_id}/orders/${orderRuning.order_id}`);
        const ondemandFee = order.total_delivery_fee;
        const ondemandOrgFee = await OrderServ.pricingOndemand(order.total_km, endpoints.length) || 0;
        if (order.type_request == REQUEST_TYPE_ON_DEMAND && !_.isEmpty(order)) {
            const driver = await SQLUser.findOne<SQLUser>({ where: { id: driver_id } });
            const user = await SQLUser.findOne<SQLUser>({ where: { id: user_id } });
            shipTransactions = AccountantServ.ondemand_fee_customer(driver.id, driver.driver_type, ondemandFee, ondemandOrgFee, user_id);
            await AccountantServ.execTransactions(shipTransactions);
        }

        await FB.ref(`queue-order-completed/tasks`).push(dataPush);
    }

    LOG.logAction(parseInt(req.header('userid')), 'HOAN_TAT', { id: order_id, name: '' }, { order_compled: dataPush });

    return HC.SUCCESS;
}));

// truongpn
router.put('/:id/status/cancelled', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const orderId = req.params.id;
    const order = await FB.get(`pool/${orderId}`);

    // Lock thao tac nhan va huy order
    const keyLockOrder = `lock:pool:${orderId}`;
    const lockOrder = await redlock.lock(keyLockOrder, 1000);
    if (_.isEmpty(order)) {
        throw _.logicError('Could not find order', `Order ${orderId} not found`, 400, ERR.OBJECT_NOT_FOUND, orderId);
    }
    await FB.ref(`pool/${orderId}/status/isCancelled`).set(1);
    lockOrder.unlock();

    //cdinh 20170921: logging cancel booking action
    LOG.logAction(parseInt(req.header('userid')), 'BOOKING_CANCELLED', { id: orderId, name: '' }, { order: order });

    return HC.SUCCESS;
}));

//cdinh 20170921: post logging missed booking
const logMissedBookingBody = _ajv({
    '+@order_id': 'string',
    '+@order_address': 'string',
    '+@order_lat': 'number|>=-90|<=90',
    '+@order_lng': 'number|>=-180|<=180',
    '+@user_id': 'integer',
    '+type_request': { enum: [CF.REQUEST_TYPE_SAMEDAY, CF.REQUEST_TYPE_ON_DEMAND] },
    '++': false
});
router.post('/log/booking_missed', _.validBody(logMissedBookingBody), _.routeAsync(async (req) => {
    const user_id = parseInt(req.body.user_id);
    const orderId = req.body.order_id;

    LOG.logAction(user_id, 'BOOKING_MISSED', { id: orderId, name: '' }, { order: req.body });

    return HC.SUCCESS;
}));
//truongpn: driver accepted order 
router.put("/:id/status/accepted", _.routeAsync(async (req) => {
    const orderId = req.params.id;
    const driverId = parseInt(req.header('userid'));
    // Lock thao tac nhan va huy order
    const keyLockOrder = `lock:pool:${orderId}`;
    const lockOrder = await redlock.lock(keyLockOrder, 1000);
    // Running 
    const order: Order = await FB.get<Order>(`pool/${orderId}`, Order.fromJSON);
    if (_.isEmpty(order)) {
        throw _.logicError('Could not find order', `Order ${orderId} not found`, 400, ERR.OBJECT_NOT_FOUND, orderId);
    }
    await OrderServ.acceptedOrder(driverId, order);

    const runningOrder = await FB.get<IRunningOrder>(`running_orders/${order.order_id}`);
    if (_.isEmpty(runningOrder)) {
        throw _.logicError('Could not find running order', `Running order ${order.order_id} not found`, 400, ERR.OBJECT_NOT_FOUND, order.order_id);
    }
    const tmpOrder: SQLTempOrder = await SQLTempOrder.findById<SQLTempOrder>(order.order_id);
    const endpoints: Endpoint[] = JSON.parse(tmpOrder.content).map(Endpoint.fromJSON);

    //Add list endpoint
    if (order.type_request == REQUEST_TYPE_SAMEDAY) {
        const endpointsDropoff = _.filter(endpoints, { 'type': CF.ALL_ENDPOINT_TYPE.DROPOFF });
        const endpointsPickup = _.filter(endpoints, { 'type': CF.ALL_ENDPOINT_TYPE.PICKUP });
        const fromDistrict = _.first(endpointsPickup).district;
        // Tinh phi and them endpoint
        for (let i = 0; i < endpointsDropoff.length; i++) {
            endpointsDropoff[i].id = await EndpointServ.genEndpointId();
            endpointsDropoff[i].endpoint_code = await EndpointServ.genEndpointCode();
            endpointsDropoff[i].order_id = order.order_id;
            endpointsDropoff[i].org_order_id = order.order_id;
            endpointsDropoff[i].status = ALL_ENDPOINT_STATUSES.DELIVERING;
            endpointsDropoff[i].created_at = moment().format(HC.DATETIME_FMT);
            endpointsDropoff[i].updated_at = moment().format(HC.DATETIME_FMT);
            const pricingCtx: IPricingContext = {
                from_district: parseInt(fromDistrict),
                to_district: parseInt(endpointsDropoff[i].district),
                weight: 0,
                fragile: false,
                is_document: 0,
                COD: 0
            }
            let deliv_fee = await PricingServ.calcPricing(pricingCtx);

            const user_id = runningOrder.user_id;
            const code: string = await FB.get<string>(`promotion-code-with-order/${runningOrder.order_id}/code_promotion`) || null;
            const contextPromotion = {
                user_id: user_id,
                endpoint_id: endpointsDropoff[i].id
            }
            const codePromotion = await PromotionServ.getCodeIfAvailable(code, contextPromotion);
            if (!_.isEmpty(codePromotion)) {
                const rewards = JSON.parse(codePromotion.rewards);
                const decrease_amount = await PromotionServ.reward(deliv_fee, rewards);
                deliv_fee = deliv_fee - decrease_amount;
            }

            endpointsDropoff[i].deliv_fee = deliv_fee;
            order.endpoints.push(endpointsDropoff[i]);
            const contextEndpoint = {
                runningOrder: runningOrder,
                order: order,
                endpoint: endpointsDropoff[i]
            };
            console.log(i);
            await EndpointServ.addEndpointAndTrackingToFirebase(contextEndpoint);
            await EndpointServ.pricingSameDayEndpoint(contextEndpoint);
        }
    } else {
        // Add endpoint
        for (let i = 0; i < endpoints.length; i++) {
            endpoints[i].id = await EndpointServ.genEndpointId();
            endpoints[i].endpoint_code = await EndpointServ.genEndpointCode();
            endpoints[i].status = ALL_ENDPOINT_STATUSES.DELIVERING;
            endpoints[i].created_at = moment().format(HC.DATETIME_FMT);
            endpoints[i].updated_at = moment().format(HC.DATETIME_FMT);
            order.endpoints.push(endpoints[i]);
            const context = {
                runningOrder: runningOrder,
                order: order,
                endpoint: endpoints[i]
            };
            await EndpointServ.addEndpointAndTrackingToFirebase(context);
            if (order.type_ondemand == ALL_ONDEMAND_TYPE.BFM) {
                await EndpointServ.pricingBuyMeEndpoint(context);
            }
            if (order.type_ondemand == ALL_ONDEMAND_TYPE.DN) {
                await EndpointServ.pricingDelivNowEndpoint(context);
            }
        }
    }

    lockOrder.unlock();

    LOG.logAction(parseInt(req.header('userid')), 'CHAP_NHAN', { id: orderId, name: '' }, { endpoints: endpoints, runningOrder: runningOrder });

    return HC.SUCCESS;
}));

//truongpn: monitor dispath order 
router.put("/:listId/mper/:mperId", AuthServ._AuthApiKey(HC.APIKEY), _.routeAsync(async (req) => {
    const listId: string[] = _.split(req.params.listId, ',');
    const driverId = parseInt(req.params.mperId);

    const listIdSucess = await Promise.all(listId.map(async orderId => {
        // Lock thao tac nhan va huy order
        const keyLockOrder = `lock:pool:${orderId}`;
        const lockOrder = await redlock.lock(keyLockOrder, 1000);
        // Running  
        const order: Order = await FB.get<Order>(`pool/${orderId}`, Order.fromJSON);
        if (_.isEmpty(order)) {
            throw _.logicError('Could not find order', `Order ${orderId} not found`, 400, ERR.OBJECT_NOT_FOUND, orderId);
        }
        await OrderServ.acceptedOrder(driverId, order);

        const runningOrder = await FB.get<IRunningOrder>(`running_orders/${order.order_id}`);
        if (_.isEmpty(runningOrder)) {
            throw _.logicError('Could not find running order', `Running order ${order.order_id} not found`, 400, ERR.OBJECT_NOT_FOUND, order.order_id);
        }
        const tmpOrder: SQLTempOrder = await SQLTempOrder.findById<SQLTempOrder>(order.order_id);
        const endpoints: Endpoint[] = JSON.parse(tmpOrder.content).map(Endpoint.fromJSON);

        //Add list endpoint
        if (order.type_request == REQUEST_TYPE_SAMEDAY) {
            const endpointsDropoff = _.filter(endpoints, { 'type': CF.ALL_ENDPOINT_TYPE.DROPOFF });
            const endpointsPickup = _.filter(endpoints, { 'type': CF.ALL_ENDPOINT_TYPE.PICKUP });
            const fromDistrict = _.first(endpointsPickup).district;
            // Tinh phi and them endpoint
            for (let i = 0; i < endpointsDropoff.length; i++) {
                endpointsDropoff[i].id = await EndpointServ.genEndpointId();
                endpointsDropoff[i].endpoint_code = await EndpointServ.genEndpointCode();
                endpointsDropoff[i].status = ALL_ENDPOINT_STATUSES.DELIVERING;
                endpointsDropoff[i].created_at = moment().format(HC.DATETIME_FMT);
                endpointsDropoff[i].updated_at = moment().format(HC.DATETIME_FMT);
                const pricingCtx: IPricingContext = {
                    from_district: parseInt(fromDistrict),
                    to_district: parseInt(endpointsDropoff[i].district),
                    weight: 0,
                    fragile: false,
                    is_document: 0,
                    COD: 0
                }
                let deliv_fee = await PricingServ.calcPricing(pricingCtx);

                const user_id = runningOrder.user_id;
                const code: string = await FB.get<string>(`promotion-code-with-order/${runningOrder.order_id}/code_promotion`) || null;
                const contextPromotion = {
                    user_id: user_id,
                    endpoint_id: endpointsDropoff[i].id
                }
                const codePromotion = await PromotionServ.getCodeIfAvailable(code, contextPromotion);
                if (!_.isEmpty(codePromotion)) {
                    const rewards = JSON.parse(codePromotion.rewards);
                    const decrease_amount = await PromotionServ.reward(deliv_fee, rewards);
                    deliv_fee = deliv_fee - decrease_amount;
                }

                endpointsDropoff[i].deliv_fee = deliv_fee;
                order.endpoints.push(endpointsDropoff[i]);
                const contextEndpoint = {
                    runningOrder: runningOrder,
                    order: order,
                    endpoint: endpointsDropoff[i]
                };
                console.log(i);
                await EndpointServ.addEndpointAndTrackingToFirebase(contextEndpoint);
                await EndpointServ.pricingSameDayEndpoint(contextEndpoint);
            }
        } else {
            // Add endpoint
            for (let i = 0; i < endpoints.length; i++) {
                endpoints[i].id = await EndpointServ.genEndpointId();
                endpoints[i].endpoint_code = await EndpointServ.genEndpointCode();
                endpoints[i].status = ALL_ENDPOINT_STATUSES.DELIVERING;
                endpoints[i].created_at = moment().format(HC.DATETIME_FMT);
                endpoints[i].updated_at = moment().format(HC.DATETIME_FMT);
                order.endpoints.push(endpoints[i]);
                const context = {
                    runningOrder: runningOrder,
                    order: order,
                    endpoint: endpoints[i]
                };
                await EndpointServ.addEndpointAndTrackingToFirebase(context);
                if (order.type_ondemand == ALL_ONDEMAND_TYPE.BFM) {
                    await EndpointServ.pricingBuyMeEndpoint(context);
                }
                if (order.type_ondemand == ALL_ONDEMAND_TYPE.DN) {
                    await EndpointServ.pricingDelivNowEndpoint(context);
                }
            }
        }
        lockOrder.unlock();
    }));

    LOG.logAction(29, 'GAN_DON', { id: driverId.toString(), name: 'driver' }, { listId: listId });

    return _.filter(listIdSucess, id => id != null);
}));

// truongpn
const ratingOrderBody = _ajv({
    '+@rating_note': 'string',
    '+@rating': 'integer|>=0|<=5',
    '++': false
});
router.put('/:id/rating', _.validBody(ratingOrderBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const user_id = parseInt(req.header('userid'));
    const rating_note = req.body.rating_note;
    const rating = parseInt(req.body.rating);
    const order_id = req.params.id;

    await FB.ref(`users/${user_id}/need_rating`).remove();

    try {
        // Check user
        const user = await FB.get<User>(`users/${user_id}`);
        if (_.isEmpty(user)) {
            throw _.logicError('Could not find user', `User ${user_id} not found`, 400, ERR.OBJECT_NOT_FOUND, user_id);
        }

        // Check order
        const order = await SQLOrder.find<SQLOrder>({
            where: {
                id: order_id
            }
        });
        if (_.isEmpty(order)) {
            throw _.logicError('Could not find order', `Order ${order_id} not found`, 400, ERR.OBJECT_NOT_FOUND, order_id);
        }

        // Update database
        const _order = await SQLOrder.update(
            {
                rating: rating,
                rating_note: rating_note
            },
            {
                where:
                    { id: order_id }
            }
        );

        LOG.logAction(parseInt(req.header('userid')), 'DANH_GIA', { id: order_id, name: '' }, { rating: rating, rating_note: rating_note });
    }
    catch (err) {
        // not handle this error, later would save to error log
        console.log(err);
    }

    return HC.SUCCESS;
}));

export default router;