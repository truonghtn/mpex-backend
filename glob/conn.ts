import * as mysql from 'mysql';
import * as redis from 'redis';
import {Sequelize} from 'sequelize-typescript';
import * as FBAdmin from 'firebase-admin';
import * as elasticsearch from 'elasticsearch';
const NodeGeocoder = require('node-geocoder');

import _ from '../utils/_';
// import * as ConnMysql from '../utils/mysql-promisified';
import * as ConnRedis from '../utils/redis-promisified';
// import * as mongo from 'mongodb';

import * as ENV from './env'

// ************ CONFIGS ************

// export let MYSQL: ConnMysql.IConnMySql
export let REDIS: ConnRedis.IConnRedis;
export let FB: FBExt;
export let ELASTIC: elasticsearch.Client;
export let SEQ: Sequelize;
export let GEOCODER;

interface FBExt extends FBAdmin.database.Database {
    get<T>(key: string): Promise<T>;
    get<T>(key: string, init: (any) => T): Promise<T>;
    getSnapshot(key: string): Promise<admin.database.DataSnapshot>;
}

export async function configureConnections() {
    // let mysqlPool: mysql.IPool = null;
    // let redisConn: redis.RedisClient = null;

    if (ENV.name == ENV.ENV_NAME.PRODUCTION) {
        FBAdmin.initializeApp({
            databaseURL: 'https://mpex-prod.firebaseio.com',
            credential: FBAdmin.credential.cert(require('./firebase/mpex-prod-firebase-adminsdk-mgfy6-e4dfbeadba.json'))
        });
        SEQ =  new Sequelize({
            host: 'sv.db.mpex.vn',
            name: 'windeliv_production',
            dialect: 'mysql',
            username: 'windeliv_prod',
            password: 'J4NFJvDQH7LyVAhS',
            logging: false,
            modelPaths: [__dirname + '/../models/sql']
        });

        ELASTIC = new elasticsearch.Client({
            host: 'http://elastic.mpex.vn:8000',
            log: [{
                type: 'stdio',
                levels: ['error'] // change these options
            }],
            httpAuth: `truongpn:truongpn`,
        });
    }
    else if (ENV.name == ENV.ENV_NAME.PRODUCTION_V2) {
        FBAdmin.initializeApp({
            databaseURL: 'https://mpex-prod-v2.firebaseio.com/',
            credential: FBAdmin.credential.cert(require('./firebase/mpex-prod-v2-firebase-adminsdk-j9cu1-39fc95c8ef.json'))
        });
        SEQ =  new Sequelize({
            host: 'sv.db.mpex.vn',
            name: 'mpex_prod_v2',
            dialect: 'mysql',
            username: 'mpex_prod_v2',
            password: 'l3GhaehMBQilIQfN',
            logging: false,
            modelPaths: [__dirname + '/../models/sql']
        });

        ELASTIC = new elasticsearch.Client({
            host: 'http://elastic.mpex.vn:8000',
            log: [{
                type: 'stdio',
                levels: ['error'] // change these options
            }],
            httpAuth: `truongpn:truongpn`,
        });
    }
    else if (ENV.name == ENV.ENV_NAME.STAGING) {
        FBAdmin.initializeApp({
            databaseURL: 'https://mpex-test-734af.firebaseio.com',
            credential: FBAdmin.credential.cert(require('./firebase/mpex-test-734af-firebase-adminsdk-68ojk-98f2486f1d.json'))
        })
        SEQ =  new Sequelize({
            host: 'sv.db.mpex.vn',
            name: 'windeliv_staging',
            dialect: 'mysql',
            username: 'windeliv_staging',
            password: 'HZztpZ3tqW9SPVPp',
            logging: false,
            modelPaths: [__dirname + '/../models/sql']
        });

        ELASTIC = new elasticsearch.Client({
            host: 'http://elastic.mpex.vn:8000',
            log: [{
                type: 'stdio',
                levels: ['error'] // change these options
            }],
            httpAuth: `truongpn:truongpn`,
        });

        const options = {
            provider: 'google',
            httpAdapter: 'https',
            apiKey: 'AIzaSyCAZ44R4sBEQdUrC-aO2U4FN1ZFV4wGyLI', 
            formatter: null
        };
        GEOCODER = NodeGeocoder(options);
    }
    else {
        FBAdmin.initializeApp({
            databaseURL: 'https://truonghtn-mpex-dev.firebaseio.com',
            credential: FBAdmin.credential.cert(require('./firebase/truonghtn-mpex-dev-firebase-adminsdk-fll7b-ae2047b2dd.json'))
        })
        SEQ =  new Sequelize({
            host: 'sv.db.mpex.vn',
            name: 'windeliv_staging',
            dialect: 'mysql',
            username: 'windeliv_staging',
            password: 'HZztpZ3tqW9SPVPp',
            modelPaths: [__dirname + '/../models/sql']
        });

        ELASTIC = new elasticsearch.Client({
            host: 'http://elastic.mpex.vn:8000',
            log : [{
                type: 'stdio',
                levels: ['error'] // change these options
            }],
            httpAuth: `truongpn:truongpn`,
        });

        const options = {
            provider: 'google',
            httpAdapter: 'https',
            apiKey: 'AIzaSyCAZ44R4sBEQdUrC-aO2U4FN1ZFV4wGyLI', 
            formatter: null
        };
        GEOCODER = NodeGeocoder(options);
    }

    REDIS = ConnRedis.createConnRedis(redis.createClient());
    FB = mkFirebaseExt(FBAdmin.database());
}

function mkFirebaseExt(fb: FBAdmin.database.Database): FBExt {
    fb['get'] = async <T> (key: string, init: (any) => T) => {
        if (init == undefined) {
            init = (obj) => obj;
        }

        return init((await fb.ref(key).once('value')).val());
    }

    fb['getSnapshot'] = (key: string) => {
        return fb.ref(key).once('value');
    }

    return <FBExt> fb;
}