import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as moment from 'moment';

import * as ENV from './glob/env';
import * as CONN from './glob/conn';
import HC from './glob/hc';
import _ from './utils/_';

import SessionServ from './serv/sess';
import AuthServ from './serv/auth';
import * as LogServ from './serv/log';

// Import routers
import EndpointRoute from './routes/endpoints';
import OrderRoute from './routes/orders';
import OpenAPIRoute from './routes/open-apis';
import DriverAPIRoute from './routes/drivers';
import UserAPIRoute from './routes/users';
import PriceRoute from './routes/price';
import PromotionCodeRoute from './routes/promotionCodes';
import AppRoute from './routes/apps';

import EndpointServ from './serv/endpoint';

class Program {
    public static async main(): Promise<number> {
        ENV.configure(process.env.NODE_ENV);
        await CONN.configureConnections();

        // start cronjob
        LogServ.init();
        
        const server = express();
        server.use(bodyParser.json());

        // create session object
        server.use(SessionServ());
        // AuthServ.MODEL = UserModel;

        server.all('*', (req, resp, next) => {
            console.log(`${req.method}: ${req.url}`);
            // console.log(req.headers);
            if (!_.isEmpty(req.body)) {
                console.log(JSON.stringify(req.body, null, 2));
            }

            next();
        });

        // CORS
        server.all('*', function (req, res, next) {
            res.header('Access-Control-Allow-Origin', "*");
            res.header('Access-Control-Allow-Methods', 'OPTIONS, POST, GET, PUT, DELETE');
            res.header('Access-Control-Allow-Credentials', 'true');
            res.header('Access-Control-Max-Age', '86400');
            res.header('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, ' +
                'Content-Type, Accept, Authentication, Authorization, sess, apikey');

            if (req.method.toUpperCase() == 'OPTIONS') {
                res.statusCode = 204;
                res.send();
                return;
            }

            next();
        });

        // Configure routes
        server.use('/endpoints', EndpointRoute);
        server.use('/orders', OrderRoute);
        server.use('/open-apis', OpenAPIRoute);
        server.use('/drivers',DriverAPIRoute);
        server.use('/users',UserAPIRoute);
        server.use('/price',PriceRoute);
        server.use('/promotion-codes',PromotionCodeRoute);
        server.use('/apps', AppRoute);

        // Start server
        server.listen(ENV.port, async function () {
            console.log("Listen on port " + ENV.port + " ...");
        });

        return 0;
    }
}

Program.main();