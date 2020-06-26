import * as express from 'express';
import * as moment from 'moment';
import * as uuid from 'uuid';

import HC from '../glob/hc';
import ERR from '../glob/err';
import { REDIS, FB } from '../glob/conn';
import _ from '../utils/_';
import ajv2 from '../utils/ajv2';

// Import models here
import { IRunningOrder } from '../models/RunningOrder';
import { Endpoint } from '../models/Endpoint';
import { Tracking } from '../models/Tracking';
import SQLEndpoint from '../models/sql/SQLEndpoint';
import { MPEXImage, MPEXImageJSONDesc } from '../models/MPEXImage';

// Import services here
import AuthServ from '../serv/auth';
import EndpointServ from '../serv/endpoint';
import { ENV_NAME } from '../glob/env';

const router = express.Router();
const _ajv = ajv2();

const CURRENT_VERSION = {
    'AND_MPER': {
        version: ['1.8', '1.9'],
        url: ''
    },
    'AND_MPEX': {
        version: ['1.8', '1.9'],
        url: 'https://play.google.com/store/apps/details?id=vn.mpex.customer'
    },
    'IOS_MPEX': {
        version: ['1.0.9', '1.1.0'],
        url: 'itms-apps://itunes.apple.com/app/mpex/id1248681943'
    }
}

const checkVersionBody = _ajv({
    '+app': { enum: ['AND_MPER', 'AND_MPEX', 'IOS_MPEX'] },
    '+@version': 'string',
    '++': false
});
router.post('/version', _.validBody(checkVersionBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const app: string = req.body.app;
    const versions = CURRENT_VERSION[app].version;
    return {
        success: _.includes(versions, req.body.version),
        url: CURRENT_VERSION[app].url,
        env_firebase: process.env.NODE_ENV
    }
}));

export default router;