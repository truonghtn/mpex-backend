import * as express from 'express';
import * as moment from 'moment';
import * as uuid from 'uuid';
import * as lodash from 'lodash';
import * as shortid from 'shortid';
import * as request from 'request-promise';
import * as pad from 'string-padding';
import * as bases from 'bases';

import * as ENV from '../glob/env';
import HC from '../glob/hc';
import { ALL_ENDPOINT_STATUSES, REQUEST_TYPE_SAMEDAY } from '../glob/cf';
import ERR from '../glob/err';
import { REDIS, FB } from '../glob/conn';
import _ from '../utils/_';
import ajv2 from '../utils/ajv2';
import * as CF from '../glob/cf';

// Import models here
import { IRunningOrder } from '../models/RunningOrder';
import { Endpoint } from '../models/Endpoint';
import { Tracking } from '../models/Tracking';
import SQLEndpoint from '../models/sql/SQLEndpoint';
import { MPEXImage, MPEXImageJSONDesc } from '../models/MPEXImage';
import { SQLPricingMisc } from '../models/sql/SQLPricingMisc';
import SQLUser from '../models/sql/SQLUser';

// Import services here
import AuthServ from '../serv/auth';
import EndpointServ, { IAddEndpointContext } from '../serv/endpoint';
import { AccountantServ} from '../serv/accountant';
import OrderServ from '../serv/order';
import * as SMSServ from '../serv/sms';
import LockServ from '../serv/lock';
import { LOG } from '../serv/log';
import { SQLPromotionCodes } from "../models/sql/SQLPromotionCodes";
import { IPromotionContext, PromotionServ } from "../serv/promotion";
import { Order } from '../models/Order';

const router = express.Router();
const _ajv = ajv2();
const lock = new LockServ();

router.get('/code', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    return {
        code: await EndpointServ.genEndpointCode()
    };
})); 

router.get('/code/:code/exist', _.routeAsync(async (req) => {
    const code: string = req.params.code;
    const endpointCode = await SQLEndpoint.find<SQLEndpoint>({where: {endpoint_code: code}, attributes: ['id']});
    return {
        exist: !_.isEmpty(endpointCode)
    }
}));

router.put('/:code/del', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const code: string = req.params.code;

    const endpoint = await FB.get(`tracking_endpoints/${code}`, Tracking.fromJSON);

    if (_.isEmpty(endpoint)) {
        throw _.logicError('Could not find endpoint', `Endpoint ${code} not found`, 400, ERR.OBJECT_NOT_FOUND, code);
    }

    const driver_id: number = endpoint.driver_id;
    const user_id: number = endpoint.user_id;
    const order_id: string = endpoint.order_id;
    const endpoint_id: string = endpoint.endpoint_id;

    const order = await FB.ref(`users/${user_id}/orders/${order_id}/endpoints`).once('value');
    if (_.values(order.val()).length <2){
        throw _.logicError('Could not delete endpoint', `Endpoint ${code} not delete`, 400, ERR.COULD_NOT_DELETE, code);
    }

    await Promise.all([
        FB.ref(`winders/${driver_id}/orders/${order_id}/endpoints/${endpoint_id}`).remove(),
        FB.ref(`users/${user_id}/orders/${order_id}/endpoints/${endpoint_id}`).remove(),
        FB.ref(`tracking_endpoints/${code}`).remove()
    ]);

    return HC.SUCCESS
}))


// truongpn
// Create endpoint tu mobile
const addEndpointBody = _ajv({
    '+@endpoint_code': 'string',
    '+@order_id': 'string|len>0',
    '+@address': 'string',
    '+@customer_name': 'string',
    '+@customer_phone': 'string',
    '+@customer_note': 'string',
    '+@lat': 'number|>=-90|<=90',
    '+@lng': 'number|>=-180|<=180',
    '+@deliv_fee': 'integer|>=0',
    '+@cash_on_deliv': 'integer|>=0',
    '+@fragile': 'boolean',
    '+@img': 'string',
    '+type': {enum: [0, 1]},
    '@org_deliv_fee': 'integer|>=0',
    '++': false
});
router.post('/', _.validBody(addEndpointBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const driver = req.header('userid');
    const endpointId = await EndpointServ.genEndpointId();
    console.log('endpoint id');
    console.log(endpointId);
    const orderId: string = req.body.order_id;
    const runningOrder = await FB.get<IRunningOrder>(`running_orders/${orderId}`);
    if (_.isEmpty(runningOrder)) {
        throw _.logicError('Could not find running order', `Running order ${orderId} not found`, 400, ERR.OBJECT_NOT_FOUND, orderId);
    }

    const order: Order = await FB.get<Order>(`winders/${driver}/orders/${orderId}`, Order.fromJSON);

    const endpoint = new Endpoint({
        id: endpointId, 
        endpoint_code: req.body.endpoint_code,
        org_order_id: req.body.order_id,
        order_id: req.body.order_id,
        address: req.body.address,
        lat: req.body.lat,
        lng: req.body.lng,
        deliv_fee: req.body.deliv_fee,
        org_deliv_fee: req.body.org_deliv_fee,
        cash_on_deliv: req.body.cash_on_deliv,
        fragile: req.body.fragile,
        img: req.body.img,
        created_at: moment().format(HC.DATETIME_FMT),
        status: ALL_ENDPOINT_STATUSES.DELIVERING,
        type: req.body.type,
        customer_name: req.body.customer_name,
        customer_phone: req.body.customer_phone,
        customer_note: req.body.customer_note,
        updated_at: moment().format(HC.DATETIME_FMT)
    });

    if (_.isEmpty(endpoint.endpoint_code)) {
        endpoint.endpoint_code = await EndpointServ.genEndpointCode();
    }

    EndpointServ.addEndpointFromMobile(endpoint, order, runningOrder);
    
    LOG.logAction(parseInt(req.header('userid')), 'TAO_MOI_ENDPOINT', { id: endpointId, name: '' }, { endpoint:  endpoint });    

    return endpoint;
}));


// truongpn
// import endpoint tu monitor
const importEndpointBody = _ajv({
    '+data': {
        'type': 'array',
        '@items': {
            '+@stt': 'number|>0',
            '+@endpoint_code': 'string',
            '+@address': 'string',
            '+@customer_name': 'string',
            '+@customer_phone': 'string',
            '+@customer_note': 'string',
            '+@lat': 'number|>=-90|<=90',
            '+@lng': 'number|>=-180|<=180',
            '+@deliv_fee': 'integer|>=0',
            '+@cash_on_deliv': 'integer|>=0',
            '+@fragile': 'boolean',
            '++': false
        }
    },
    '++': false
});
router.post('/import', _.validBody(importEndpointBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    
    //truongpn Cai tien sau
    const arrImported = [];
    await Promise.all(req.body.data.map(async element => {
        const endpointId = await EndpointServ.genEndpointId();

        const endpointCode = element.endpoint_code == "" ? await EndpointServ.genEndpointCode() : element.endpoint_code;

        const endpoint = new Endpoint({
            id: endpointId, 
            endpoint_code: endpointCode,
            address: element.address,
            lat: element.lat,
            lng: element.lng,
            deliv_fee: element.deliv_fee,
            cash_on_deliv: element.cash_on_deliv,
            fragile: element.fragile,
            img: "",
            created_at: moment().format(HC.DATETIME_FMT),
            status: ALL_ENDPOINT_STATUSES.NONE,
            type: 1,
            customer_name: element.customer_name,
            customer_phone: element.customer_phone,
            customer_note: element.customer_note
        });
        await FB.ref(`imported_endpoint/${endpoint.id}`).set(endpoint.toJSON());

        LOG.logAction(parseInt(req.header('userid')), 'IMPORT_ENDPOINT', { id: endpointId, name: '' }, { endpoint:  endpoint });

        arrImported.push({stt: element.stt, endpoint_code: endpointCode});
    }));  

    return arrImported;
}));


// truongpn
// broadcast order endpoint
// Chuyen tu work sang
const broadcastOrderEndpointBody = _ajv({
    '@user_id': 'number',
    '@driver_id': 'number',
    '@created_at': 'string',
    '+endpoints': {
        'type': 'array',
        '@items': {
            '+@endpoint_id': 'string',
            '+@endpoint_code': 'string',
            '+@address': 'string',
            '+@customer_name': 'string',
            '+@customer_phone': 'string',
            '+@customer_note': 'string',
            '+@lat': 'number|>=-90|<=90',
            '+@lng': 'number|>=-180|<=180',
            '+@deliv_fee': 'integer|>=0',
            '+@cash_on_deliv': 'integer|>=0',
            '+@fragile': 'boolean',
            // '+@img': 'string',
            // '+type': {enum: [0, 1]},
            '++': false
        }
    },
    '++': false
});
const DefaultOrderAddr = {
    order_lat: 10.80728,
    order_lng: 106.6621293,
    order_address: '33A Trường Sơn, P.4, Q. Tân Bình, Tp. Hồ Chí Minh'
}
router.post('/broadcast-order', _.validBody(broadcastOrderEndpointBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const data = req.body;
    const listIdEp: string[] = data.endpoints.map(e => e.endpoint_id);
    
    const release = await lock.lock(listIdEp.map(id => `broadcast-order|${id}`));
    
    try {
        const orderId = await OrderServ.genOrderId();

        // const endpoints = _.keyBy(data.endpoints, 'endpoint_id');

        const endpoints: Endpoint[] = await Promise.all(listIdEp.map(async id => {
            const endpoint = await FB.get<Endpoint>(`imported_endpoint/${id}`);
            if (_.isEmpty(endpoint)){
                throw _.logicError('Could not find endpoint', `Order ${id} not found`, 400, ERR.OBJECT_NOT_FOUND, id);
            }
            endpoint.created_at = moment().format(HC.DATETIME_FMT),
            endpoint.order_id = orderId;
            if (_.isEmpty(endpoint.org_order_id)) {
                endpoint.org_order_id = orderId;
            }
            endpoint.status = ALL_ENDPOINT_STATUSES.DELIVERING;
            return endpoint;
        }))

        const defaultData = {
            user_id: parseInt(data.user_id),
            order_id: orderId,
            order_code: shortid.generate().toUpperCase(),
            order_lat: DefaultOrderAddr.order_lat,
            order_lng: DefaultOrderAddr.order_lng,
            order_address: DefaultOrderAddr.order_address,
            type_request: CF.REQUEST_TYPE_SAMEDAY,
            order_districts: null,
            total_km: 0,
            total_delivery_fee: 0,
            created_at: data.created_at,
            updated_at: moment().format(HC.DATETIME_FMT),
            status: 8,
            endpoints: _.keyBy(endpoints, 'id')
        };

        const winderId = data.driver_id;

        const tasks: Promise<void>[] = [];
        //winder endpoint
        tasks.push(FB.ref(`winders/${winderId}/orders/${defaultData.order_id}`).set(defaultData));

        const winder = (await FB.ref(`winders/${winderId}`).once('value')).val();
        const userOrderData = lodash.merge(defaultData, {
            winder_info: {
                winder_id: winderId,
                winder_name: winder.first_name || '',
                winder_phone: winder.phone || '',
                winder_avatar: winder.avatar || '',
                winder_group: winder.group_name || '',
                winder_rating: parseFloat(winder.rating || 0),
                winder_distance_accumulation: winder.distance_accumulation || 0,
                facebook_id: winder.facebook_id || 0
            }
        });
        //winder endpoint
        tasks.push(FB.ref(`users/${defaultData.user_id}/orders/${defaultData.order_id}`).set(userOrderData));

        tasks.push(FB.ref(`running_orders/${defaultData.order_id}`).set({
            order_id: defaultData.order_id,
            winder_id: winderId,
            user_id: defaultData.user_id
        }));

        //Tracking endpoints
        for (const i in data.endpoints){
            const endpointTracking = await FB.ref('/tracking_endpoints').orderByKey().equalTo(i).once('value');
            if (_.isEmpty(endpointTracking.val())){
                tasks.push(FB.ref(`tracking_endpoints/${data.endpoints[i].endpoint_code}`).set({
                    driver_id: winderId,
                    order_id: defaultData.order_id,
                    endpoint_id: data.endpoints[i].endpoint_id,
                    user_id: data.user_id
                }));
            } else {
                tasks.push(FB.ref(`tracking_endpoints/${data.endpoints[i].endpoint_code}/driver_id`).set(winderId));
                tasks.push(FB.ref(`tracking_endpoints/${data.endpoints[i].endpoint_code}/order_id`).set(defaultData.order_id));                
            }
            
        }

        //Remove import endpoints
        for (const i in data.endpoints){
            tasks.push(FB.ref(`imported_endpoint/${data.endpoints[i].endpoint_id}`).remove());
        }

        await Promise.all(tasks);

        return HC.SUCCESS
    }
    finally {
        release();
    }
    
}));

// Truongpn
// Chuyển endpoint vào kho
const warehousingBody = _ajv({
    '+data': {
        'type': 'array'
    },
    '++': false
});
router.post('/warehousing', _.validBody(warehousingBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const listEpId = req.body.data;
    
    await Promise.all(listEpId.map(async id => {
        if (id != null){
            const endpoint = await FB.get<Endpoint>(`imported_endpoint/${id}`);
            await FB.ref(`warehousing/${endpoint.id}`).set(endpoint);
            //remove
            await FB.ref(`imported_endpoint/${endpoint.id}`).remove();

            LOG.logAction(parseInt(req.header('userid')), 'LUU_KHO', { id: endpoint.id, name: '' }, { endpoint:  endpoint });  
        }
    })); 

    return HC.SUCCESS
}));


// truongpn
const editEndpointBody = _ajv({
    '+@order_id': 'string',
    '+@driver_id': 'integer|>0',
    '+@user_id': 'integer|>0',
    '+@endpoint': {
        '@address': 'string',
        '@customer_name': 'string',
        '@customer_phone': 'string',
        '@customer_note': 'string',
        '@lat': 'number|>=-90|<=90',
        '@lng': 'number|>=-180|<=180',
        '@deliv_fee': 'integer|>=0',
        '@cash_on_deliv': 'integer|>=0',
        '@fragile': 'boolean',
        '@img': 'string',
        'type': {enum: [0, 1]},
        '@org_deliv_fee': 'integer|>=0',
    },
    '++': false
});
router.put('/:id', _.validBody(editEndpointBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {

    const editTableFields = ['address', 'customer_name', 'customer_phone', 'customer_note', 'lat', 'lng', 'deliv_fee', 'cash_on_deliv', 'fragile', 'img', 'type', 'org_deliv_fee'];

    const endpointId = req.params.id;
    const driverId = req.body.driver_id;
    const userId = req.body.user_id;
    const orderId = req.body.order_id;

    const order: any = await FB.get(`winders/${driverId}/orders/${orderId}`);
    if (_.isEmpty(order)){
        throw _.logicError('Could not find order', `Order ${orderId} not found`, 400, ERR.OBJECT_NOT_FOUND, orderId);
    }

    const oldTotalFee = order.total_delivery_fee;

    const endpoint = await FB.get<Endpoint>(`winders/${driverId}/orders/${orderId}/endpoints/${endpointId}`);
    if (_.isEmpty(endpoint)){
        throw _.logicError('Could not find endpoint', `Endpoint ${endpointId} not found`, 400, ERR.OBJECT_NOT_FOUND, endpointId);
    }

    const oldEndpointFee = endpoint.deliv_fee;

    const data = req.body.endpoint;
    const fieldsBody = _.keys(data).filter(k => data[k] != undefined);

    const updatedFields = _.intersection(fieldsBody, editTableFields);
    updatedFields.forEach(f => endpoint[f] = data[f]);
    if (updatedFields.length > 0) {
        endpoint.updated_at = moment().format(HC.DATETIME_FMT);
    }

    await FB.ref(`winders/${driverId}/orders/${orderId}/endpoints/${endpointId}`).set(endpoint);
    await FB.ref(`users/${userId}/orders/${orderId}/endpoints/${endpointId}`).set(endpoint);
    
    if (order.type_request == CF.REQUEST_TYPE_SAMEDAY) {
        const totalDeliveryFee = oldTotalFee - oldEndpointFee + endpoint.deliv_fee;
    
        await FB.ref(`winders/${driverId}/orders/${orderId}/total_delivery_fee`).set(totalDeliveryFee);
        await FB.ref(`users/${userId}/orders/${orderId}/total_delivery_fee`).set(totalDeliveryFee);
    } else {
        const newOrder: Order = await FB.get<Order>(`winders/${driverId}/orders/${orderId}`);
        const runningOrder = await FB.get<IRunningOrder>(`running_orders/${orderId}`);
        
        const context: IAddEndpointContext = {
            runningOrder: runningOrder,
            order: newOrder,
            endpoint: endpoint
        };
        if (newOrder.type_ondemand == CF.ALL_ONDEMAND_TYPE.BFM) {
            EndpointServ.pricingBuyMeEndpoint(context);
        } else {
            EndpointServ.pricingDelivNowEndpoint(context);
        }
    }

    LOG.logAction(parseInt(req.header('userid')), 'CAP_NHAT', { id: endpoint.id, name: '' }, { endpoint:  endpoint });      

    return HC.SUCCESS;
}));


// API Checkin fail
const checkinFailedBody = _ajv({
    '+@order_id': 'string',
    '+@driver_id': 'integer|>0',
    '+@user_id': 'integer|>0',
    '@reason_id': 'integer|>0',
    '++': false
})

router.put('/checkin-fail/:endpoint_id', _.validBody(checkinFailedBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    
    const endpointId = req.params.endpoint_id;
    const driverId = req.body.driver_id;
    const userId = req.body.user_id;
    const orderId = req.body.order_id;
    
    const endpoint = await FB.get<Endpoint>(`winders/${driverId}/orders/${orderId}/endpoints/${endpointId}`);
    if (_.isEmpty(endpoint)){
        throw _.logicError('Could not find endpoint', `Endpoint ${endpointId} not found`, 400, ERR.OBJECT_NOT_FOUND, endpointId);
    }

    const endpointUserSnap = await FB.get<Endpoint>(`users/${userId}/orders/${orderId}/endpoints/${endpointId}`);
    if(_.isEmpty(endpointUserSnap)){
        throw _.logicError('Could not find endpoint',`Could not find endpoint id ${endpointId} in user id ${userId}`,400, ERR.OBJECT_NOT_FOUND, endpointId);
    }

    await Promise.all([
         FB.ref(`winders/${driverId}/orders/${orderId}/endpoints/${endpointId}/status`).set(ALL_ENDPOINT_STATUSES.NOT_DELIV),
         FB.ref(`users/${userId}/orders/${orderId}/endpoints/${endpointId}/status`).set(ALL_ENDPOINT_STATUSES.NOT_DELIV)
    ]);

    LOG.logAction(parseInt(req.header('userid')), 'CHECK_IN_THAT_BAI', { id: endpoint.id, name: '' }, { endpoint:  endpoint });      

    return HC.SUCCESS;
}));

const checkinSuccessBody = _ajv({
    '+@order_id': 'string',
    '+@driver_id': 'integer|>0',
    '+@user_id': 'integer|>0',
    '++': false
})
router.put('/checkin-success/:endpoint_id', _.validBody(checkinSuccessBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    
    const endpointId = req.params.endpoint_id;
    const driverId = req.body.driver_id;
    const userId = req.body.user_id;
    const orderId = req.body.order_id;
    
    const endpoint = await FB.get<Endpoint>(`winders/${driverId}/orders/${orderId}/endpoints/${endpointId}`);
    if (_.isEmpty(endpoint)){
        throw _.logicError('Could not find endpoint', `Endpoint ${endpointId} not found`, 400, ERR.OBJECT_NOT_FOUND, endpointId);
    }

    const endpointUserSnap = await FB.get<Endpoint>(`users/${userId}/orders/${orderId}/endpoints/${endpointId}`);
    if(_.isEmpty(endpointUserSnap)){
        throw _.logicError('Could not find endpoint',`Could not find endpoint id ${endpointId} in user id ${userId}`,400, ERR.OBJECT_NOT_FOUND, endpointId);
    }

    // const orderPromotionCode = await FB.get(`promotion-code-with-order/${orderId}`);

    await Promise.all([
        FB.ref(`winders/${driverId}/orders/${orderId}/endpoints/${endpointId}/status`).set(ALL_ENDPOINT_STATUSES.DELIVERED),
        FB.ref(`users/${userId}/orders/${orderId}/endpoints/${endpointId}/status`).set(ALL_ENDPOINT_STATUSES.DELIVERED),
        
        FB.ref(`tracking_endpoints/${endpoint.endpoint_code}/status`).set(CF.ALL_TRACKING_STATUSES.DELIVERED)
    ]);

    const orgOrderRunning = await FB.get<IRunningOrder>(`running_orders/${endpoint.org_order_id}`);
    if ( endpoint.org_order_id != endpoint.order_id ) {
        await Promise.all([
            FB.ref(`winders/${orgOrderRunning.winder_id}/orders/${orgOrderRunning.order_id}/endpoints/${endpoint.id}/status`).set(ALL_ENDPOINT_STATUSES.DELIVERED),
            FB.ref(`users/${orgOrderRunning.user_id}/orders/${orgOrderRunning.order_id}/endpoints/${endpoint.id}/status`).set(ALL_ENDPOINT_STATUSES.DELIVERED)
        ]);
        const endpoints: Endpoint[] = _.values(await FB.get(`winders/${orgOrderRunning.winder_id}/orders/${orgOrderRunning.order_id}/endpoints`)).map(Endpoint.fromJSON);
        const endpointWHS = endpoints.find(e => e.status == CF.ALL_ENDPOINT_STATUSES.WAREHOUSING);
        if (_.isEmpty(endpointWHS)) {
            const dataCompleted = {
                winder_id: orgOrderRunning.winder_id,
                user_id: orgOrderRunning.user_id,
                order_id: endpoint.org_order_id,
                is_forced: false
            }

            const endpoints: Endpoint[] = _.values(await FB.get(`winders/${orgOrderRunning.winder_id}/orders/${orgOrderRunning.order_id}`)).map(Endpoint.fromJSON);
            //Tracking endpoints
            endpoints.forEach(async e => {
                if ( e.org_order_id == orgOrderRunning.order_id){
                    await FB.ref(`tracking_endpoints/${e.endpoint_code}`).remove();
                }
            })
            await FB.ref(`queue-order-completed/tasks`).push(dataCompleted);
        }
    }

    const driver = await SQLUser.findOne<SQLUser>({where: {id: driverId}});
    const orgDriverId = orgOrderRunning.winder_id;

    // Shipper nhận tiền ship từ người nhận
    const amountFeeShip = endpoint.deliv_fee;
    const amountCOD = endpoint.cash_on_deliv;
    let transactions = [];
    const order: any = await FB.get(`winders/${driverId}/orders/${orderId}`);
    if (order.type_request == REQUEST_TYPE_SAMEDAY && !_.isEmpty(order)) {
        const shipTransactions = AccountantServ.ship_fee_customer(driverId, driver.driver_type, orgDriverId, amountFeeShip, null, userId);
        const codTransactions = AccountantServ.ship_cod_customer(driverId, amountCOD, null, userId);
        transactions = [...shipTransactions, ...codTransactions];
        await AccountantServ.execTransactions(transactions);
    }
    
    LOG.logAction(parseInt(req.header('userid')), 'CHECK_IN_THANH_CONG', { id: endpoint.id, name: '' }, { endpoint:  endpoint, transactions: transactions || null });

    // const driverRevenueTransactions = shipTransactions.filter(tr => tr.transaction_type == "NHAN_SHIP_SHARED");
    
    return HC.SUCCESS;
}));

// truongpn
// Shipper nhận trước tiền ship từ chủ shop
router.put('/:code/confirm-delivfee', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const user_id = parseInt(req.header('userid'));
    const endpointCode = req.params.id;

    const endpointTracking = await FB.get<Tracking>(`tracking_endpoints/${endpointCode}`);
    if (_.isEmpty(endpointTracking)){
        throw _.logicError('Could not find endpoint', `Endpoint ${endpointCode} not found`, 400, ERR.OBJECT_NOT_FOUND, endpointCode);
    }

    const endpoint = await FB.get<Endpoint>(`winders/${endpointTracking.driver_id}/orders/${endpointTracking.order_id}/endpoints/${endpointTracking.endpoint_id}`);
    if (_.isEmpty(endpoint)){
        throw _.logicError('Could not find endpoint', `Endpoint ${endpointCode} not found`, 400, ERR.OBJECT_NOT_FOUND, endpointCode);
    }
    if (endpoint.isDelivFee == true){
        throw _.logicError('', `Endpoint ${endpointCode} delivered fee`, 500, ERR.UNKNOWN, endpointCode);         
    }

    const amount = endpoint.cash_on_deliv;

    await AccountantServ.execTransactions(AccountantServ.ship_fee_user(user_id, amount, null, null));

    LOG.logAction(user_id, 'CONFIRM_DELIV_FEE', { id: req.header('userid'), name: '' }, { endpoint:  endpointTracking.endpoint_id, cash_on_deliv:  amount});

    return HC.SUCCESS;
}));

export default router;