import FBObject from './FBObject';
import MPEXImage from './MPEXImage';
import * as CF from '../glob/cf';
import { Endpoint } from './Endpoint';
import { ONDEMAND_TYPE, ALL_ONDEMAND_TYPE } from '../glob/cf';

class winder_info {
    winder_id: string = "";
    winder_name: string = "";
    winder_phone: string = "";
    winder_avatar: string = "";
    winder_group: string = ""; 
    winder_rating: number = 0;
    winder_distance_accumulation: number = 0;
    facebook_id: string = "";
}

export class Order extends FBObject {
    oder_code: string = "";
    order_id: string = "";
    order_address: string = "";
    order_lat: number = 0;
    order_lng: number = 0;
    total_delivery_fee: number = 0;
    total_km: number = 0;
    status: CF.ENDPOINT_STATUS = 'NONE';
    type_request: number = 0;
    user_id: string = "";
    updated_at: string = "";
    endpoints: Endpoint[] = [];
    winder_info: winder_info;
    type_ondemand: ONDEMAND_TYPE = ALL_ONDEMAND_TYPE.NONE;
    constructor(json: any) {
        super();
        Object.assign(this, json);
        this.endpoints = (json.endpoints == undefined ? []: Object.keys(json.endpoints).map(Endpoint.fromJSON));
    }

    static fromJSON(json: any) {
        return new Order(json);
    }
};

export default Endpoint;