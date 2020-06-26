import * as express from 'express';
import * as request from 'request-promise';

import _ from '../utils/_';
import * as ENV from '../glob/env';
import * as C from '../glob/cf';
import HC from '../glob/hc';
import ERR from '../glob/err';

// import { IUser } from '../models/user';
type IUser = any;

export interface IAuthUserModel {
    getUserByAuthID(authID: string): Promise<IUser>;
}

export interface IAuthServConfig {
    UsernameField: string;
}

interface IOAuth2Credentials {
    client_id: string;
    client_secret: string;
}

export class AuthServ {
    static CONFIG = <IAuthServConfig> {
        UsernameField: 'X-Consumer-Username'
    };

    static MODEL: IAuthUserModel

    static authRole(...roles: C.ROLE[]) {
        return _.routeNextableAsync(async (req, resp, next) => {
            const authID = req.header(this.CONFIG.UsernameField);
            if (_.isEmpty(authID)) {
                throw _.logicError('Permission denied', 'Invalid user', 403, ERR.UNAUTHORIZED, authID);
            }

            const user = await this.MODEL.getUserByAuthID(authID);
            if (_.isEmpty(user)) {
                throw _.logicError('Permission denied', 'Invalid role', 403, ERR.INVALID_ROLE);
            }

            // const isHasRole = await this.MODEL.isAuthIDHasRole(authID, role);
            if (!this.checkRole(user.roles, roles)) {
                throw _.logicError('Permission denied', 'Invalid role', 403, ERR.INVALID_ROLE);
            }

            req.session.user = user;
            next();
        });
    }

    static checkRole(roles: C.ROLE[], required: C.ROLE[]) {
        for (const r of required) {
            if (roles.indexOf(r) >= 0) {
                return true;
            }
        }

        return false;
    }

    static async registerAuth(user: IUser) {
        user.auth = <any> {};
        user.auth.authID = `BPTR@${_.randomstring.generate({length: 16})}`;

        const kongId = await this.createKongConsumer(user.auth.authID);
        user.auth.kongID = kongId;

        let oauth2 = await this.createOAuth2Credentials(user.auth.authID, kongId);
        if (_.isEmpty(oauth2.client_id) || _.isEmpty(oauth2.client_secret)){
            oauth2 = await this.getOAuth2Credentials(kongId);
        }
        
        user.auth.kongClientID = oauth2.client_id;
        user.auth.kongClientSecrect = oauth2.client_secret;

        return user;
    }

    private static async createKongConsumer(username: string) {
        const opts = {
            url: `${ENV.host_kong_admin}/consumers`,
            method: 'POST',
            form: {
                username: username
            },
            json: true
        };

        try {
            const data = await request(opts);
            return <string> data.id || null;
        }
        catch (ex) {
            const consumer = await this.getKongConsumer(username);
            return consumer.id;
        }
    }

    private static async getKongConsumer(username: string) {
        const opts = {
            url: `${ENV.host_kong_admin}/consumers/${username}`,
            method: 'GET',
            json: true
        };

        return await request(opts);
    }

    private static async getOAuth2Credentials(kongId: string) {
        const opts = {
            url: `${ENV.host_kong_admin}/consumers/${kongId}/oauth2`,
            method: 'GET',
            json: true
        };

        const body = await request(opts);
        return <IOAuth2Credentials> {
            client_id: body.client_id,
            client_secret: body.client_secret
        };
    }

    private static async createOAuth2Credentials(username: string, kongId: string) {
        const opts = {
            url: `${ENV.host_kong_admin}/consumers/${username}/oauth2`,
            method: 'POST',
            form: {
                name: username,
                redirect_uri: ENV.host_redirect
            },
            json: true
        };


        const body = await request(opts);
        return <IOAuth2Credentials> {
            client_id: body.client_id,
            client_secret: body.client_secret
        };
    }

    static async authKongToken(user: IUser, pass: string) {
        const url = `${ENV.host}/oauth2/token`;
        const body = {
            grant_type: 'password',
            client_id: user.auth.kongClientID,
            client_secret: user.auth.kongClientSecrect,
            scope: 'all',
            provision_key: HC.HOST_PROVISION,
            authenticated_userid: user.auth.kongID,
            username: user.auth.authID,
            password: pass
        }

        const data = await request({
            url,
            form: body,
            method: 'POST',
            json: true
        });

        return data;
    }

    static _AuthApiKey(...keys: string[]) {
        return _.routeNextableAsync(async (req, resp, next) => {
            const apikey = req.header('apikey') || (req.body && req.body['apikey']) || '';
            if (!_.includes(keys, apikey)) {
                throw _.logicError(`Invalid key authentication`, `Key ${apikey} are invalid`, 401, ERR.UNAUTHORIZED, apikey);
            }
            
            next();
        });
    }

    static AuthConsumer(...consumers: string[]) {
        return _.routeNextableAsync(async (req, resp, next) => {
            const consumer = req.header(this.CONFIG.UsernameField);
            if (!_.includes(consumers, consumer)) {
                throw _.logicError(`Invalid key authentication`, `Consumer are invalid`, 401, ERR.UNAUTHORIZED, consumer);
            }

            next();
        })
    }
}

export default AuthServ;