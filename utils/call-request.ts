       
import * as request from 'request-promise';
import * as ENV from '../glob/env';

export function callAPI_TPS(method: string, uri: string, body: any) {
    const headers = {
    };
    return request(`${ENV.host_tps}${uri}`, {
        method: method,
        body: body,
        headers: headers,
        json: true
    });
}