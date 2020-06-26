import * as express from 'express';
import * as moment from 'moment';
import * as uuid from 'uuid';
import * as request from 'request-promise';

import HC from '../glob/hc';
import ERR from '../glob/err';
import { REDIS, FB } from '../glob/conn';
import _ from '../utils/_';
import ajv2 from '../utils/ajv2';
import * as ENV from '../glob/env';
import { FACEBOOK_APP_ID, ACCOUNT_KIT_APP_SECRET } from '../glob/env';
import * as CF from '../glob/cf';

// Import models here
import SQLUser from '../models/sql/SQLUser';
import Notification from '../models/sql/Notification';

// Import services here
import AuthServ from '../serv/auth';
import UserServ from '../serv/user';
import ReferalServ from '../serv/referral';
import { callAPI_TPS } from '../utils/call-request';

const router = express.Router();
const _ajv = ajv2();

const loginBodyAK = _ajv({
    '+@authorization_code': 'string',
    '+@account_type': 'number',
    '++': false
});
router.post('/login-ak', _.validBody(loginBodyAK), _.routeAsync(async (req) => {
    const authorization_code: string = req.body.authorization_code;
    const account_type: CF.ACCOUNT_TYPE = req.body.account_type;
    const phone = await UserServ.get_phone_by_authcode(authorization_code);
    
    if (!phone) {
        throw _.logicError('Phone not exist',`Could not find phone with authorization_code ${authorization_code}`,400, ERR.PHONE_NOT_FOUND, authorization_code);
    }

    const user = await SQLUser.findOne<SQLUser>({where: {phone: phone}});

    if (_.isEmpty(user)) {
        const user_id = await UserServ.registerAK(phone, account_type);
        // ReferalServ.initReferral(user_id, account_type, req.body.referrer);
        return {
            hasEmail: false,
            phone: phone
        };
    }
    if (user.account_type != account_type) {
        throw _.logicError('Invalid account_type',`Account type is not correct`, 500, ERR.INVALID_ACCOUNT_TYPE);        
    }
    if (user.phone != phone) {
        throw _.logicError('Invalid phone',`Phone is not correct`, 500, ERR.INVALID_PHONE);        
    }
    if (_.isEmpty(user.email)){
        return {
            hasEmail: false,
            phone: phone
        }
    }

    return {
        hasEmail: true,
        phone: phone
    };
}));

const loginBody = _ajv({
    'lang': {enum: ['vi', 'en', '']},
    '+@phone': 'string',
    '+@email': 'string',
    '+@account_type': 'string',
    '@referrer': 'string'
});
router.post('/login', _.validBody(loginBody), _.routeAsync(async (req) => {
    const lang: string = req.body.lang || 'en';
    const phone: string = req.body.phone;
    const email: string = req.body.email;
    const account_type: number = req.body.account_type;

    //cdinh: get User by Phone Or Email, return User with Phone or Email existed
    const user = await SQLUser.findOne<SQLUser>({where: {$or: [{phone: phone}, {email: email}]}});
    if (user && user.email == email && user.phone == phone && user.account_type == account_type) {
        await UserServ.forgotten(phone, user.email, lang);
        return {
            statusCode: 200,
            body: {
                message: 'success'
            }
        };
    }
    else if (user) { //cdinh: either Phone or Email existed
        if (user.email != email) {
            return {
                statusCode: 400,
                body: {
                    error: 'invalid_email',
                    error_description: 'Email is not correct'
                }
            }
        }

        if (user.phone != phone) {
            return {
                statusCode: 400,
                body: {
                    error: 'invalid_phone',
                    error_description: 'Phone is not correct'
                }
            }
        }

        if (user.account_type != account_type) {
            return {
                statusCode: 400,
                body: {
                    error: 'invalid_account_type',
                    error_description: 'Account type is not correct'
                }
            }
        }
    }
    else { // create new user
        console.log(`Create new user`);
        const userId = await UserServ.register(phone, email, account_type, lang);
        console.log(`User created ${userId}`);
        if (userId != null) {
            console.log(`Start referral reward`);
            ReferalServ.initReferral(userId, account_type, req.body.referrer);

            return {
                statusCode: 200,
                body: {
                    message: 'success'
                }
            };
        }
        else {
            console.log(`Register error`);
            return {
                statusCode: 500,
                message: 'register error'
            }
        }
    }
}, (req, resp) => (err, data) => {
    if (err || data.statusCode == undefined) {
        _.createServiceCallback(resp)(err, data);
    }
    else {
        resp.statusCode = data.statusCode;
        resp.send(data.body);
    }
}));

const updatePositionBody = _ajv({
    '+@lat': 'number|>=-90|<=90',
    '+@lng': 'number|>=-180|<=180',
    '++':false
});
router.put('/:user_id/position',_.validBody(updatePositionBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER),_.routeAsync(async(req)=>{
    console.log('here');
    const userId: string = req.params.user_id;
    const userSnap = await FB.getSnapshot(`users/${userId}`);
    if(!userSnap.exists()){
        throw _.logicError('User not exist',`Could not find user id ${userId}`,400, ERR.OBJECT_NOT_FOUND, userId);
    }
    const updatePositionTask = {
        lat: req.body.lat,
        lng: req.body.lng
    }
    await FB.ref(`users/${userId}/position`).update(updatePositionTask);
    return HC.SUCCESS;
}));

// truongpn
const findNearestDriverByKmBody = _ajv({
    '+@user_lat': 'number|>=-90|<=90',
    '+@user_lng': 'number|>=-180|<=180',
    '++': false
});
router.post('/:id/find-nearest-km', _.validBody(findNearestDriverByKmBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const userId = req.params.id;
    const user = await FB.get(`users/${userId}`);
    if (_.isEmpty(user)){
        throw _.logicError('Could not find user', `User ${userId} not found`, 400, ERR.OBJECT_NOT_FOUND, userId);
    }

    const dataPush = {
        user_id: userId,
        user_lat: req.body.user_lat,
        user_lng: req.body.user_lng
    }

    await FB.ref(`queue-nearest-byKm/tasks`).push(dataPush);
    return HC.SUCCESS;
}));

router.get('/me/balance', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const uid = _.parseIntNull(req.header('userid'));
    if (uid == null) {
        throw _.logicError('Invalid uid', `User id must be number`, 400, ERR.INVALID_FORMAT, req.header('userid'));
    }

    const user = await SQLUser.findOne<SQLUser>({where: {id: uid}});
    if (_.isEmpty(user)) {
        throw _.logicError('Invalid uid', `User not found`, 400, ERR.OBJECT_NOT_FOUND, uid);
    }

    const balance = await callAPI_TPS('GET', `/${user.id}/balance`, undefined);
    return {
        balance: (balance && balance.total) || 0
    };
}))

router.get('/me/transactions', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const uid = _.parseIntNull(req.header('userid'));
    if (uid == null) {
        throw _.logicError('Invalid uid', `User id must be number`, 400, ERR.INVALID_FORMAT, req.header('userid'));
    }

    const user = await SQLUser.findOne<SQLUser>({where: {id: uid}});
    if (_.isEmpty(user)) {
        throw _.logicError('Invalid uid', `User not found`, 400, ERR.OBJECT_NOT_FOUND, uid);
    }

    const limit = _.parseIntNull(req.query.limit) || 50;
    const sinceId = _.parseIntNull(req.query.sinceId) || Number.MAX_SAFE_INTEGER;

    const transactions = await callAPI_TPS('GET', `/${user.id}/transactions?limit=${limit}&sinceId=${sinceId}`, undefined);
    if (_.isEmpty(transactions)) {
        return [];
    }

    return transactions.map(tr => ({
        id: tr.id,
        amount: tr.amount,
        time: moment(tr.time).format(HC.DATETIME_FMT),
        transaction_type: tr.transaction_type,
        content: tr.content
    }));
}));

const addNotifBody = _ajv({
    '+@user_id': 'integer|>=0',
    '+@type': 'string',
    '+@content': 'string',
    'custom': {}
});
router.post('/notifications', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const data = req.body;
    const notification = await Notification.create({
        user_id: data.user_id,
        type: data.type || null,
        time: new Date(),
        content: data.content,
        custom: data.custom && JSON.stringify(data.custom)
    });

    return {id: notification.id};
}));

router.get('/me/notifications', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const uid = _.parseIntNull(req.header('userid'));
    if (uid == null) {
        throw _.logicError('Invalid uid', `User id must be number`, 400, ERR.INVALID_FORMAT, req.header('userid'));
    }

    const user = await SQLUser.findOne<SQLUser>({where: {id: uid}});
    if (_.isEmpty(user)) {
        throw _.logicError('Invalid uid', `User not found`, 400, ERR.OBJECT_NOT_FOUND, uid);
    }

    const limit = _.parseIntNull(req.query.limit) || 50;
    const sinceId = _.parseIntNull(req.query.sinceId) || Number.MAX_SAFE_INTEGER;

    const notifications = await Notification.findAll({where: {user_id: uid, id: {$lt: sinceId}}, limit: limit, order: [['id', 'DESC']]});
    if (_.isEmpty(notifications)) {
        return [];
    }

    return notifications;
}));

router.get('/histories', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const uid = _.parseIntNull(req.header('userid'));
    const fromTime = req.query.fromTime;

    if (uid == null) {
        throw _.logicError('Invalid uid', `User id must be number`, 400, ERR.INVALID_FORMAT, req.header('userid'));
    }
    let histories = {};

    const user = await SQLUser.findOne<SQLUser>({where: {id: uid}});
    if (_.isEmpty(user)) {
        throw _.logicError('Invalid uid', `User not found`, 400, ERR.OBJECT_NOT_FOUND, uid);
    }

    let transactions = await callAPI_TPS('GET', `/${user.id}/histories?fromTime=${fromTime}`, undefined);
    if (_.isEmpty(transactions)) {
        transactions = [];
    }

    histories = {
        info_user: user,
        transactions: transactions
    }

    return histories;
}));

export default router;