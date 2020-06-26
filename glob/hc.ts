import * as moment from 'moment';

export class HC {
    static readonly SUCCESS = {success: true};
    static readonly FAILURE = {success: false};

    static readonly MINUTES_PER_DAY = 24 * 60;
    static readonly APIKEY = '2036560d86c24df4bc0e35690d38339d';
    static readonly PHP_CONSUMER = 'mpexphp';
    static readonly BEGIN_DATE = moment('2010-01-01', 'YYYY-MM-DD');
    static readonly HUMAN32_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    static readonly HOST_PROVISION = '';
    static readonly DATETIME_FMT = 'YYYY-MM-DD HH:mm:ss';

    static readonly PARTTIME_ONDEMAND_SHARED_PERCENT = 0.8;
    static readonly PARTTIME_SAMEDAY_PICKUP_COMMISSION = 5000;
    static readonly PARTTIME_SAMEDAY_DELIVER_COMMISSION = 10000;

    static readonly INHOUSE_SAMEDAY_PICKUP_COMMISSION = 2500;
    static readonly INHOUSE_SAMEDAY_DELIVER_COMMISSION = 2500;
    static readonly INHOUSE_SAMEDAY_PICKUP_DOCCUMENT_COMMISSION = 2000;
    static readonly INHOUSE_SAMEDAY_DELIVER_DOCCUMENT_COMMISSION = 2000;
    static readonly INHOUSE_ONDEMAND_SHARED_PERCENT = 0.5;

    static readonly REFERRAL_RANGE = 1000000; // 1m
    static readonly REFERRAL_RATIO = 0.05; // 5%
    static readonly MAX_TIME_USER_USED = 1;
    static readonly USER_REFERRAL_REWARD = 30000; // 30k

}

export default HC;