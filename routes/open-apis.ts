import * as express from 'express';
import * as moment from 'moment';
import * as uuid from 'uuid';

import HC from '../glob/hc';
import ERR from '../glob/err';
import { REDIS, FB, GEOCODER } from '../glob/conn';
import _ from '../utils/_';
import ajv2 from '../utils/ajv2';
import * as CF from '../glob/cf';

// Import models here
import { IRunningOrder } from '../models/RunningOrder';
import { Tracking } from '../models/Tracking';
import { SQLEndpoint } from '../models/sql/SQLEndpoint';
import { SQLUser } from '../models/sql/SQLUser';
import { Endpoint } from '../models/Endpoint';

// Import services here
import AuthServ from '../serv/auth';
import * as SMSServ from '../serv/sms';
import { LOG } from '../serv/log';
import { EndpointServ } from "../serv/endpoint";

const router = express.Router();
const _ajv = ajv2();

router.post('/warehouse/in-bounds/running-endpoints/:code', AuthServ._AuthApiKey(HC.APIKEY), _.routeAsync(async (req) => {
    const endpointCode: string = req.params.code;

    const tracking = await FB.get(`tracking_endpoints/${endpointCode}`, Tracking.fromJSON)
    if (_.isEmpty(tracking)) {
        throw _.logicError('Endpoint code not found', `Could not find endpoint code ${endpointCode}`, 400, ERR.OBJECT_NOT_FOUND, endpointCode);
    }

    const endpointId: string = tracking.endpoint_id;
    const orderId: string = tracking.order_id;

    const userPhone = await FB.get<string>(`users/${tracking.user_id}/phone`);

    // SMSServ.sendTrackingSMS(userPhone, endpointCode);

    // await Promise.all([
    //     FB.ref(`users/${tracking.user_id}/orders/${tracking.order_id}/endpoints/${endpointId}`).remove(),
    //     FB.ref(`winders/${tracking.driver_id}/orders/${tracking.order_id}/endpoints/${endpointId}`).remove(),
    //     FB.ref(`tracking/${endpointCode}`).remove()
    // ]);

    await Promise.all([
        FB.ref(`users/${tracking.user_id}/orders/${tracking.order_id}/endpoints/${endpointId}/status`).set(CF.ALL_ENDPOINT_STATUSES.WAREHOUSING),
        FB.ref(`winders/${tracking.driver_id}/orders/${tracking.order_id}/endpoints/${endpointId}/status`).set(CF.ALL_ENDPOINT_STATUSES.WAREHOUSING),
        FB.ref(`tracking_endpoints/${endpointCode}/status`).set(CF.ALL_TRACKING_STATUSES.WAREHOUSING)
    ]);

    LOG.logOpenAPI('Warehouse', req.url, { id: endpointId, name: '' }, { tracking:  tracking });  

    return HC.SUCCESS;
}));

router.post('/warehouse/in-bounds/not-deliv/:code', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const endpointCode: string = req.params.code;

    const endpoint = await SQLEndpoint.findOne<SQLEndpoint>({where: {endpoint_code: endpointCode}});
    if (_.isEmpty(endpoint)) {
        throw _.logicError('Endpoint not found', `Could not find endpoint with code ${endpointCode}`, 400, ERR.OBJECT_NOT_FOUND, endpointCode);
    }

    if (endpoint.status != 'NOT_DELIV') {
        throw _.logicError('Invalid endpoint status', `Endpoint status mismatch (expected: 'NOT_DELIV')`, 400, ERR.INVALID_STATUS);
    }

    // TODO: Should send tracking SMS
    // SMSServ.sendTrackingSMS(user, endpointCode);

    await SQLEndpoint.update({status: 'WAREHOUSING'}, {where: {id: endpoint.id}});

    LOG.logOpenAPI('Warehouse', req.url, { id: endpoint.id, name: '' }, { endpoint:  endpoint });  
    
    return HC.SUCCESS;
}));

router.post('/warehouse/in-bounds/imported/:code', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const code: string = req.params.code;
    const tmp = await FB.ref('warehousing').orderByChild('endpoint_code').equalTo(code).once('value');
    const endpoint = new Endpoint(_.first(_.values(tmp.val())));

    if (_.isEmpty(endpoint)) {
        throw _.logicError('Endpoint not found', `Could not find endpoint with code ${code}`, 400, ERR.OBJECT_NOT_FOUND, code);
    }

    await FB.ref(`warehousing/${endpoint.id}`).remove();

    await FB.ref(`tracking_endpoints/${endpoint.endpoint_code}/status`).set(CF.ALL_TRACKING_STATUSES.WAREHOUSING);

    LOG.logOpenAPI('Warehouse', req.url, { id: endpoint.id, name: '' }, { endpoint:  endpoint });      

    return HC.SUCCESS;
}));

const importEndpointFromWHBody = _ajv({
    '+@endpoint': {
        '+@id': 'string',
        '+@endpoint_code': 'string',
        '+@org_order_id': 'string',
        '+@order_id': 'string',
        '+@address': 'string',
        '+@customer_name': 'string',
        '+@customer_phone': 'string',
        '+@customer_note': 'string',
        '+@lat': 'number|>=-90|<=90',
        '+@lng': 'number|>=-180|<=180',
        '+@deliv_fee': 'integer|>=0',
        '+@cash_on_deliv': 'integer|>=0',
        '+@fragile': 'boolean',
        '@img': 'string',
        'type': {enum: [0, 1]}
    },
    '++': false
});
router.post('/warehouse/out-bounds/imported/:code', _.validBody(importEndpointFromWHBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    
    const endpoint: Endpoint = Endpoint.fromJSON(req.body.endpoint);
    endpoint.updated_at = moment().format(HC.DATETIME_FMT);

    await FB.ref(`imported_endpoint/${endpoint.id}`).set(endpoint.toJSON());

    LOG.logAction(parseInt(req.header('userid')), 'TAO_MOI_TU_KHO', { id: endpoint.id, name: '' }, { endpoint:  endpoint });  

    return HC.SUCCESS;
}));

// Shipper nạp tiền prepaid cho MPEX
const prepaidBody = _ajv({
    '+@user_id': 'integer|>=0',
    '+@total': 'integer|>=0',
    '++': false
});
router.put('/payment/prepaid', _.validBody(prepaidBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    
    const user_id = req.body.user_id;
    const total: number = req.body.total; 

    const user = await SQLUser.find<SQLUser>({where: {id: user_id}});

    if (_.isEmpty(user)) {
        throw _.logicError('User not found', `Could not find user with code ${user_id}`, 400, ERR.OBJECT_NOT_FOUND, user_id);
    }

    const transactions = [
        {
            user_id: user.id,
            amount: total,
            actor: user.id.toString(),
            actor_type: "SHIPPER",
            transaction_type: "NOP_TIEN_PREPAID",
            target: "MPEX",
            target_type: "MPEX",
            content: "Nop tien cho mpex",
            data: ""
        }
    ];
    await this.execTransactions(transactions);

    LOG.logAction(parseInt(req.header('userid')), 'NOP_TIEN_PREPAID', { id: user_id, name: '' }, { transactions:  transactions });  

    return HC.SUCCESS;
}));

// Shipper nộp tiền lại cho MPEX
const paymentBody = _ajv({
    '+@driver_id': 'integer|>=0',
    '+@total': 'integer|>=0',
    '++': false
});
router.put('/payment', _.validBody(paymentBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    
    const driver_id = req.body.driver_id;
    const total: number = req.body.total; 

    const user = await SQLUser.find<SQLUser>({where: {id: driver_id}});

    if (_.isEmpty(user)) {
        throw _.logicError('User not found', `Could not find user with code ${driver_id}`, 400, ERR.OBJECT_NOT_FOUND, driver_id);
    }

    const transactions = [
        {
            user_id: user.id,
            amount: total,
            actor: user.id.toString(),
            actor_type: "SHIPPER",
            transaction_type: "NOP_TIEN_COD",
            target: "MPEX",
            target_type: "MPEX",
            content: "Nop tien cho mpex",
            data: ""
        }
    ];

    await this.execTransactions(transactions);

    LOG.logAction(parseInt(req.header('userid')), 'NOP_TIEN_COD', { id: driver_id, name: '' }, { transactions:  transactions });  

    return HC.SUCCESS;
}));

// MPEX gửi tiền COD lại cho chủ shop
const refundCODBody = _ajv({
    '+@user_id': 'integer|>=0',
    '+@total': 'integer|>=0',
    '++': false
});
router.put('/refund/COD', _.validBody(refundCODBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    
    const user_id = req.body.user_id;
    const total: number = req.body.total; 

    const user = await SQLUser.find<SQLUser>({where: {id: user_id}});

    if (_.isEmpty(user)) {
        throw _.logicError('User not found', `Could not find user with code ${user_id}`, 400, ERR.OBJECT_NOT_FOUND, user_id);
    }

    const transactions = [
        {
            user_id: user.id,
            amount: -total,
            actor: "MPEX",
            actor_type: "MPEX",
            transaction_type: "MPEX_GUI_TIEN_COD_CHO_SHOP",
            target: user.id.toString(),
            target_type: "SHOP",
            content: "MPEX gui tien COD cho SHOP",
            data: ""
        }
    ];

    await this.execTransactions(transactions);

    LOG.logAction(parseInt(req.header('userid')), 'MPEX_GUI_TIEN_COD_CHO_SHOP', { id: user_id, name: '' }, { transactions:  transactions });  

    return HC.SUCCESS;
}));

// MPEX thanh toán tiền ship lại cho shipper
const refundShipBody = _ajv({
    '+@driver_id': 'integer|>=0',
    '+@total': 'integer|>=0',
    '++': false
});
router.put('/refund/fee', _.validBody(refundShipBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    
    const driver_id = req.body.driver_id;
    const total: number = req.body.total; 

    const user = await SQLUser.find<SQLUser>({where: {id: driver_id}});

    if (_.isEmpty(user)) {
        throw _.logicError('User not found', `Could not find user with code ${driver_id}`, 400, ERR.OBJECT_NOT_FOUND, driver_id);
    }

    const transactions = [
        {
            user_id: user.id,
            amount: -total,
            actor: "MPEX",
            actor_type: "MPEX",
            transaction_type: "MPEX_GUI_TIEN_SHIP_CHO_SHIPPER",
            target: user.id.toString(),
            target_type: "SHIPPER",
            content: "MPEX gui tien ship cho SHIPPER",
            data: ""
        }
    ];

    await this.execTransactions(transactions);

    LOG.logAction(parseInt(req.header('userid')), 'MPEX_GUI_TIEN_SHIP_CHO_SHIPPER', { id: driver_id, name: '' }, { transactions:  transactions });  

    return HC.SUCCESS;
}));

// MPEX thanh toán cho shipper nghỉ
const refundBody = _ajv({
    '+@driver_id': 'integer|>=0',
    '+@total': 'integer|>=0',
    '++': false
});
router.put('/refund', _.validBody(refundBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    
    const driver_id = req.body.driver_id;
    const total: number = req.body.total; 

    const user = await SQLUser.find<SQLUser>({where: {id: driver_id}});

    if (_.isEmpty(user)) {
        throw _.logicError('User not found', `Could not find user with code ${driver_id}`, 400, ERR.OBJECT_NOT_FOUND, driver_id);
    }

    const transactions = [
        {
            user_id: user.id,
            amount: -total,
            actor: "MPEX",
            actor_type: "MPEX",
            transaction_type: "MPEX_THANH_TOAN_SHIPPER_NGHI",
            target: user.id.toString(),
            target_type: "SHIPPER",
            content: "MPEX thanh toan SHIPPER nghi",
            data: ""
        }
    ]

    await this.execTransactions(transactions);

    LOG.logAction(parseInt(req.header('userid')), 'MPEX_THANH_TOAN_SHIPPER_NGHI', { id: driver_id, name: '' }, { transactions:  transactions });  

    return HC.SUCCESS;
}));

const importShipmentsBody = _ajv({
    '+data': {
        'type': 'array',
        '@items': {
            '+@code': 'string',
            '+@address': 'string',
            '+@customer_name': 'string',
            '+@customer_phone': 'string',
            '@note': 'string',
            '+@cash_on_deliv': 'integer|>=0',
            '++': false
        }
    },
    '++': false
});

router.post('/add-shipments', _.validBody(importShipmentsBody), _.routeAsync(async (req) => {


    const arrImported = [];
    await Promise.all(req.body.data.map(async element => {

        const location = (await GEOCODER.geocode({address: element.address, countryCode: 'VN', zipcode: '100000'}))[0];

        const endpointId = await EndpointServ.genEndpointId();

        const endpointCode = element.endpoint_code == "" ? await EndpointServ.genEndpointCode() : element.code;

        const endpoint = new Endpoint({
            id: endpointId, 
            endpoint_code: endpointCode,
            address: element.address,
            lat: location.latitude == undefined ? 0: location.latitude,
            lng: location.longitude == undefined ? 0: location.longitude,
            cash_on_deliv: element.cash_on_deliv,
            fragile: element.fragile,
            img: "",
            created_at: moment().format(HC.DATETIME_FMT),
            status: CF.ALL_ENDPOINT_STATUSES.NONE,
            type: 1,
            customer_name: element.customer_name,
            customer_phone: element.customer_phone,
            customer_note: element.note
        });
        await FB.ref(`imported_endpoint/${endpoint.id}`).set(endpoint.toJSON());

        LOG.logAction(parseInt(req.header('userid')), 'TAO_MOI_ENPOINT_OPEN_API', { id: endpointId, name: '' }, { endpoint:  endpoint });

        arrImported.push({stt: element.stt, endpoint_code: endpointCode});
    }));  

    return arrImported;
}));

export default router;