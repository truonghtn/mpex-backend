import * as express from 'express';
import * as moment from 'moment';
import * as uuid from 'uuid';

import HC from '../glob/hc';
import ERR from '../glob/err';
import { REDIS, FB } from '../glob/conn';
import _ from '../utils/_';
import ajv2 from '../utils/ajv2';

// Import models here
import SQLPromotionCode, { SQLPromotionCodes } from '../models/sql/SQLPromotionCodes';


// Import services here
import AuthServ from '../serv/auth';
import PromotionServ, { IPromotionContext } from '../serv/promotion';

const router = express.Router();
const _ajv = ajv2();

const addBody = _ajv({
    '+@nCodes': 'number|>0',
    '+constraints': {},
    '+@expiryDate': 'string',
    '+@rewards': {},
    '++':false
});
router.post('/', _.validBody(addBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const nCodes = req.body.nCodes;
    const expired = moment(req.body.expiryDate, HC.DATETIME_FMT);
    if (expired.isBefore(moment())){
        throw _.logicError('Promotion code is expired', `Promotion codes is expired`, 410, ERR.OBJECT_NOT_FOUND);        
    }

    const dataCodes: SQLPromotionCode[] = [];
    for (var i = 0; i < nCodes; i++){
        const codePromotion = new SQLPromotionCode({
            code: PromotionServ.genRandomCode(),
            expired: expired.toDate(),
            contraints: JSON.stringify(req.body.constraints),
            rewards: JSON.stringify(req.body.rewards)
        });
        dataCodes.push(codePromotion);
    }

    const promotionCodes = await SQLPromotionCode.bulkCreate<SQLPromotionCode>(dataCodes);

    return {codes: promotionCodes.map(code => code.code)};
}));

// Truongpn - Chua forward php
router.get('/:promotion_code/is_already', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const code = (req.params.promotion_code && req.params.promotion_code).toUpperCase();
    const userId = parseInt(req.header('userid'));
    if (_.isEmpty(code)) {
        return {
            success: false,
            description: ""
        };
    }
    const context: IPromotionContext = {
        user_id: userId,
        endpoint_id: null
    }
    const codePromotion = await PromotionServ.getCodeIfAvailable(code, context);
    if (_.isEmpty(codePromotion)) {
        return {
            success: false,
            description: ""
        };
    }
    return {
        success: true,
        description: codePromotion.description
    };
}));

//cdinh 20170925: lấy description của promotion code
router.get('/:promotion_code/description', AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const promoCode = req.params.promotion_code.trim();

    const promoDescription = await SQLPromotionCode.findOne(
        {where: {code: promoCode},
        attributes: ['contraints','rewards']});

    return promoDescription;
}));

export default router;