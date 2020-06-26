export enum ENV_NAME {
    PRODUCTION,
    STAGING,
    DEVELOPMENT,
    PRODUCTION_V2
}

export let name: ENV_NAME
export let port: number
export let host: string;
export let host_kong_admin: string;
export let host_redirect: string;
export let host_osrm: string;
export let host_tracking: string;
export let host_tps: string;
export let elastic_log_index: string;
export let host_account_kit: string;
export let ACCOUNT_KIT_API_VERSION: string;
export let ACCOUNT_KIT_APP_SECRET: string;
export let FACEBOOK_APP_ID: string;

export function configure(env: string) {
    this.port = 7615;
    env = env.toLowerCase();
    if (env == 'prod' || env == 'production') {
        this.name = ENV_NAME.PRODUCTION;
        host = 'http://127.0.0.1:8000/api';
        host_kong_admin = 'http://127.0.0.1:8001';
        host_redirect = 'https://mpex.vn';
        host_osrm = 'http://osrm.mpex.vn:8000';
        host_tracking = 'http://tracking.mpex.vn/#/tracking';
        host_tps = 'http://localhost:1994/open-apis';
        elastic_log_index = 'mpex';
        host_account_kit = `https://graph.accountkit.com/v1.1`;
        ACCOUNT_KIT_API_VERSION = 'v1.1';
        ACCOUNT_KIT_APP_SECRET = '8468dfa1e488aa2cdb1d39b19083c355';
        FACEBOOK_APP_ID = '1191166290936470';
    }
    else if (env == 'prod_v2' || env == 'production_v2') {
        this.port = 7612;
        this.name = ENV_NAME.PRODUCTION_V2;
        host = 'http://127.0.0.1:8000/api/v2';
        host_kong_admin = 'http://127.0.0.1:8001';
        host_redirect = 'https://mpex.vn';
        host_osrm = 'http://osrm.mpex.vn:8000';
        host_tracking = 'http://tracking.mpex.vn/#/tracking';
        host_tps = 'http://localhost:1994/open-apis';
        elastic_log_index = 'mpex';
        host_account_kit = `https://graph.accountkit.com/v1.1`;
        ACCOUNT_KIT_API_VERSION = 'v1.1';
        ACCOUNT_KIT_APP_SECRET = '8468dfa1e488aa2cdb1d39b19083c355';
        FACEBOOK_APP_ID = '1191166290936470';
    }
    else if (env == 'stag' || env == 'staging') {
        this.name = ENV_NAME.STAGING;
        host = 'http://127.0.0.1:8000/api';
        host_kong_admin = 'http://127.0.0.1:8001';
        host_redirect = 'https://mpex.vn';
        host_osrm = 'http://osrm.mpex.vn:8000';
        host_tracking = 'http://tracking.windeliv.com/#/tracking';
        host_tps = 'http://localhost:1994/open-apis';  
        elastic_log_index = 'mpex_stag';      
        host_account_kit = `https://graph.accountkit.com/v1.1`; 
        ACCOUNT_KIT_API_VERSION = 'v1.1';
        ACCOUNT_KIT_APP_SECRET = '17c139240bebf9adec193c2c820ebce6';
        FACEBOOK_APP_ID = '1205341756238724';
    }
    else {
        this.name = ENV_NAME.DEVELOPMENT;
        host = 'http://127.0.0.1:8000/api';
        host_kong_admin = 'http://127.0.0.1:8001';
        host_redirect = 'https://mpex.vn';
        host_osrm = 'http://osrm.mpex.vn:8000';
        host_tracking = 'http://tracking.windeliv.com/#/tracking';
        host_tps = 'http://localhost:1994/open-apis';
        elastic_log_index = 'mpex_dev';
        host_account_kit = `https://graph.accountkit.com/v1.1`;
        ACCOUNT_KIT_API_VERSION = 'v1.1';
        ACCOUNT_KIT_APP_SECRET = '17c139240bebf9adec193c2c820ebce6';
        FACEBOOK_APP_ID = '1205341756238724';
    }
}