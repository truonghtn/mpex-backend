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

const router = express.Router();
const _ajv = ajv2();

const updatePositionBody = _ajv({
    '+@lat': 'number|>=-90|<=90',
    '+@lng': 'number|>=-180|<=180',
    '++':false
});
router.put('/:driver_id/position', _.validBody(updatePositionBody), AuthServ.AuthConsumer(HC.PHP_CONSUMER), _.routeAsync(async (req) => {
    const driverId: string = req.params.driver_id;
    const driverSnap = await FB.getSnapshot(`winders/${driverId}`);
    if(!driverSnap.exists()){
        throw _.logicError('Driver not exist', `Could not find driver with id ${driverId}`, 400, ERR.OBJECT_NOT_FOUND, driverId);
    }
    const updatePositionTask = {
        lat: req.body.lat,
        lng: req.body.lng,
    }

    await FB.ref(`winders/${driverId}/position`).update(updatePositionTask);
    return HC.SUCCESS;
}));

export default router;