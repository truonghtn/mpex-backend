import FBObject from './FBObject';
import * as CF from '../glob/cf';

// export interface ITracking {
//     driver_id: number;
//     user_id: number;
//     order_id: string;
//     endpoint_id: string;
// };

export class Tracking extends FBObject {
    driver_id: number;
    user_id: number;
    order_id: string;
    endpoint_id: string;
    status: CF.TRACKING_STATUS;
    
    constructor(json: any) {
        super();
        Object.assign(this, json);
    }

    static fromJSON(json: any) {
        return new Tracking(json);
    }
    
}

export default Tracking;