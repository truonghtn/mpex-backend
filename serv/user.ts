import * as bcrypt from 'bcrypt';
import _ from '../utils/_';
import * as ENV from '../glob/env';
import { FACEBOOK_APP_ID, ACCOUNT_KIT_APP_SECRET } from '../glob/env';
import * as CF from '../glob/cf';
import * as request from 'request-promise';

import { FB } from '../glob/conn';

import SQLUser from '../models/sql/SQLUser';
import { HC } from "../glob/hc";


export class UserServ {
    static readonly TEST_USERS = ['01234567890', '01663016163', '01677791893', '01646564357', '0963242917'];

    static async get_phone_by_authcode(authorization_code: string) {
        console.log('..........................................');
        console.log(FACEBOOK_APP_ID);
        console.log(ACCOUNT_KIT_APP_SECRET);
        const app_access_token: string = ['AA', FACEBOOK_APP_ID, ACCOUNT_KIT_APP_SECRET].join('|');
        // const params = {
        //     grant_type: 'authorization_code',
        //     code: authorization_code,
        //     access_token: app_access_token
        // };
    
        const resp_access_token = await request(`${ENV.host_account_kit}/access_token?grant_type=authorization_code&code=${authorization_code}&access_token=${app_access_token}`, {
            method: 'GET',
            json: true
        });
    
        const resp_endpoint = await request(`${ENV.host_account_kit}/me?access_token=${resp_access_token.access_token}`, {
            method: 'GET',
            json: true
        });
        const phone = `0${resp_endpoint.phone.national_number}`;
        if (!phone) {
            return null;
        }

        return phone;
    }

    static async forgotten(phone: string, email: string, lang: string) {
        if (!phone) {
            return false;
        }
        
        const user = await SQLUser.findOne<SQLUser>({where: {phone: phone}});
        if (!user) {
            return false;
        }

        // add logic for test users
        const isTestUser = _.includes(this.TEST_USERS, phone);
        const password = isTestUser ? '11111' : _.random(10000, 99999, false).toString();
        const hash: string = await bcrypt.hash(password, 10);
        await user.update({active_code: hash});

        if (!isTestUser) {
            await this.sendActivateCode(user.email, phone, password, lang);
        }

        return true;
    }

    static async registerAK(phone: string, accountType: CF.ACCOUNT_TYPE) {
        if (_.isEmpty(phone) || accountType == undefined || isNaN(accountType)) {
            return null;
        }
        
        // add new user when register.
        const userData: any = {
            'phone': phone,
            'account_type': accountType,
            'activated': accountType == 1 ? 1 : 0,
        };

        const user = await SQLUser.create<SQLUser>(userData);
        
        return user.id;
    }

    static async register(phone: string, email: string, accountType: number, lang: string) {
        if (_.isEmpty(phone) || _.isEmpty(email) || accountType == undefined || isNaN(accountType) || _.isEmpty(lang)) {
            return null;
        }
        
        console.log(`account type = ${accountType}`);

        // add new user when register.
        const name = _.first(email.split('@')) || '';
        const password = _.random(10000, 99999).toString();
        const hash: string = await bcrypt.hash(password, 10);
        const userData: any = {
            'phone': phone,
            'active_code': hash,
            'account_type': accountType,
            'email': email,
            'user_deposit': accountType == 1 ? /*$this->getDI()->get('deposit')->register*/ 0 : 0,
            'activated': accountType == 1 ? 1 : 0,
            'first_name': name
        };

        const user = await SQLUser.create<SQLUser>(userData);
        if (user.id == null) {
            return null;
        }

        userData.id = user.id;
        const userType = accountType == 2 ? 'winders' : 'users';
        await Promise.all([
            this.sendActivateCode(email, phone, password, lang),
            FB.ref(`/${userType}/${user.id}`).update(userData)
        ]);
        
        return user.id;
    }

    static sendActivateCode(email: string, phone: string, code: string, lang: string) {
        return Promise.all([
            FB.ref('/queue-email/tasks').push({
                'to_address': email,
                'type': 'resend',
                'phone_no': phone,
                'active_code': code,
                'lang': lang
            }),
            FB.ref('/queue-send-sms/tasks').push({
                'type': 'resend',
                'phone_no': phone,
                'data': [code],
                'lang': lang
            })
        ]);
    }
}

export default UserServ;