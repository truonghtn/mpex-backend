import * as moment from 'moment';
import HC from '../glob/hc';
import * as ENV from '../glob/env';
import * as elasticsearch from 'elasticsearch';
import { ELASTIC } from '../glob/conn';

import _ from '../utils/_';
import ERR from '../glob/err';

import { SQLUser } from '../models/sql/SQLUser'

type ACTION = 'CONFIRM_DELIV_FEE' | 'MPEX_THANH_TOAN_SHIPPER_NGHI' | 'MPEX_GUI_TIEN_SHIP_CHO_SHIPPER' | 
            'MPEX_GUI_TIEN_COD_CHO_SHOP' | 'NOP_TIEN_COD' | 'NOP_TIEN_PREPAID' | 'TINH_PHI' | 'CAP_NHAT' |
            'TAO_MOI_BOOKING' | 'HOAN_TAT' | 'CHAP_NHAN' | 'DANH_GIA' | 'LUU_KHO' | 'CHECK_IN_THAT_BAI' | 'CHECK_IN_THANH_CONG' |
            'TINH_PHI_ORDER_ONDEMAND' | 'TAO_MOI_TU_KHO' | 'PROMOTION_COE' | 'ADD_SHIPMENT' | 'TAO_MOI_ENDPOINT' | 'IMPORT_ENDPOINT' | 'TAO_MOI_ENPOINT_OPEN_API'
            | 'BOOKING_CANCELLED' | 'BOOKING_MISSED'| 'GAN_DON' ;

export class LogServ {
    _client: elasticsearch.Client;

    constructor(client: elasticsearch.Client){
        this._client = client;
    }

    private writeLog(indexName: string, typeIndex: string, body: any){
        return this._client.index({
            index: indexName,
            type: typeIndex,
            body: body
        });
    }
    
    //cdinh: 20170921: add phone & email
    async logAction(uid: number, action: ACTION, target: {id: string, name: string}, params: Object) {
        const user = await SQLUser.find<SQLUser>({where: {id: uid}, attributes: ['id', 'first_name', 'last_name', 'phone', 'email']});
        if (_.isEmpty(user)) {
            throw _.logicError('User not exist', `Could not find user with id ${uid}`, 400, ERR.OBJECT_NOT_FOUND, uid);
        }
        const name = `${user.first_name} ${user.last_name}`;
        const body = {
            actor: {
                id: user.id,
                name: name.trim(),
                phone: user.phone,
                email: user.email
            },
            action: action,
            target: target,
            params: params,
            time: moment().format('YYYY-MM-DD HH:mm:ss')
        };
        this.writeLog(ENV.elastic_log_index, 'action', body);
    }

    async logOpenAPI(actor: string, uri: string, target: {id: string, name: string}, params: Object) {
        const body = {
            actor: actor,
            uri: uri,
            target: target,
            params: params,
            time: moment().format('YYYY-MM-DD HH:mm:ss')
        };
        this.writeLog(ENV.elastic_log_index, 'openAPI', body);
    }

    closeConnection() {
        // close connection
    }
}

export let LOG: LogServ;
export function init() {
    LOG = new LogServ(ELASTIC);
}
export default LOG;