import FBObject from './FBObject';
import MPEXImage from './MPEXImage';
import * as CF from '../glob/cf';

export class Endpoint extends FBObject {
    id: string = "";
    endpoint_code: string = "";
    org_order_id: string = "";
    order_id: string = "";
    address: string = "";
    lat: number = 0;
    lng: number = 0;
    deliv_fee: number = 0;
    cash_on_deliv: number = 0;
    fragile: Boolean = false;
    img: string = "";
    created_at: string = "";
    status: CF.ENDPOINT_STATUS = 'NONE';
    type: number = 0;
    customer_name: string = "";
    customer_phone: string = "";
    customer_note: string = "";
    updated_at: string = "";
    //
    isDelivFee: Boolean = false;
    org_deliv_fee: number = 0;
    district: string = "";

    constructor(json: any) {
        super();
        Object.assign(this, json);
    }

    static fromJSON(json: any) {
        return new Endpoint(json);
    }
};

export default Endpoint;