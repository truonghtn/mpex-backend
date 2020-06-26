import { FB } from '../glob/conn';
import * as ENV from '../glob/env';

export function sendTrackingSMS(phone: string, endpointCode: string, lang: string = 'vi') {
    return FB.ref(`queue-send-sms/tasks`).push({
        'type': 'tracking',
        'phone_no': phone,
        'data': [`${ENV.host_tracking}/${endpointCode}`],
        'lang': lang
    });
}