import FBObject from './FBObject';
import MPEXImage from './MPEXImage';
import * as CF from '../glob/cf';
import _ from '../utils/_';

export class User extends FBObject {
    activated: number = 0
    available: number = 0
    device_os: number = 0
    device_token: string = ""
    email: string = ""
    first_name: string = ""
    lang: string = ""
    nearest: _.Dictionary<any> = {}
    nearestByKm: _.Dictionary<any> = {}
    orders: _.Dictionary<any> = {}
    phone: string = ""

    constructor(json: any) {
        super();
        Object.assign(this, json);
    }

    static fromJSON(json: any) {
        return new User(json);
    }
}