import * as shortId32 from 'shortid32';
import { SQLPromotionCodes } from "../models/sql/SQLPromotionCodes";
import _ from '../utils/_';
import { ERR } from "../glob/err";
import * as moment from 'moment';
import { REDIS } from "../glob/conn";
import { Endpoint } from "../models/Endpoint";

import * as pad from 'string-padding';
import * as bases from 'bases';
import { HC } from "../glob/hc";

export interface IPromotionContext {
    endpoint_id: string;
    user_id: number;
}

export class PromotionServ {
    static genRandomCode() {
        const code = shortId32.generate();
        return code;
    }

    static async getCodeIfAvailable(code: string, context: IPromotionContext): Promise<SQLPromotionCodes> {
        if (_.isEmpty(code)) {
            return null;
        }

        const regex = /^[A-Za-z0-9]+$/;
        if (!regex.test(code)) {
            return null;
        }

        const codePromotion = await SQLPromotionCodes.find<SQLPromotionCodes>({
            where: {
                code: code,
                enabled: true
            }
        });

        if (_.isEmpty(codePromotion)) {
            return null;
        }

        const isCodeAvailable = await PromotionServ.isCodeAvailable(codePromotion, context);
        if (!isCodeAvailable) {
            return null;
        }

        return codePromotion;
    }

    private static async isCodeAvailable(codePromotion: SQLPromotionCodes, ctx: IPromotionContext) : Promise<boolean> {
        const promotionKey = `mx:pr:${codePromotion.code}`;
        if (!_.isEmpty(ctx.endpoint_id)) {
            const isApplied = await REDIS.sismember(promotionKey, ctx.endpoint_id);
            if (isApplied) {
                return true;
            }
        }

        if (moment(codePromotion.expired).isBefore()){
            return false;
        }

        const conditions = JSON.parse(codePromotion.contraints);
        const todayId = bases.toAlphabet(moment().diff(HC.BEGIN_DATE, 'd'), HC.HUMAN32_ALPHABET);
        
        // phase check
        for (const cond in conditions) {
            const data = conditions[cond];
            if (cond == 'limit_by_usage') {
                const keyToDay = `mx:pr:${codePromotion.code}:${pad(todayId, 3, '0')}:n`;
                const keyTotal = `mx:pr:${codePromotion.code}:n`;

                // check max
                const nUsedTotal = _.parseIntNull(await REDIS.get(keyTotal)) || 0;
                console.log('used total:');
                console.log(nUsedTotal);
                const limitTotal = data.total_limit
                if (nUsedTotal >= limitTotal) {
                    return false;
                }

                const nUsedToDay = _.parseIntNull(await REDIS.scard(keyToDay)) || 0;
                const limitEachDay = data.each_day_limit;
                if (nUsedToDay >= limitEachDay) {
                    return false;
                }
            }
            else if (cond == 'limit_each_user') {
                const key = `mx:pr:${codePromotion.code}:usrs`;
                // check max
                const nUsed = _.parseIntNull(await REDIS.hget(key, ctx.user_id)) || 0;
                const limit: number = data;
                if (nUsed >= limit) {
                    return false;
                }
            }
        }

        return true;
    }

    static async recordUsage(codePromotion: SQLPromotionCodes, context: IPromotionContext) {
        const code = codePromotion.code;
        const conditions = JSON.parse(codePromotion.contraints);
        
        const promotionKey = `mx:pr:${codePromotion.code}`;
        await REDIS.sadd(promotionKey, context.endpoint_id);
        
        for (const key in conditions) {
            const cond = conditions[key];
            if (key == 'limit_by_usage') {
                const todayId = bases.toAlphabet(moment().diff(HC.BEGIN_DATE, 'd'), HC.HUMAN32_ALPHABET);
                const promotionKeyByDay = `mx:pr:${codePromotion.code}:${pad(todayId, 3, '0')}:n`;
                const promotionKeyTotal = `mx:pr:${codePromotion.code}:n`;
                const eachDayLimit: number = cond.each_day_limit;
                const nUsedToDay = _.parseIntNull((await REDIS.scard(promotionKeyByDay))) || 0;
                console.log('today limit');
                console.log(nUsedToDay);
                console.log(eachDayLimit);
                if (nUsedToDay < eachDayLimit) {
                    await Promise.all([
                        REDIS.sadd(promotionKeyByDay, context.endpoint_id),
                        REDIS.incr(promotionKeyTotal)
                    ]);
                }
            }
            else if (key == 'limit_each_user') {
                const key = `mx:pr:${code}:usrs`
                await REDIS.hincrby(key, context.user_id, 1);
            }
        }
    }

    static async reward(price: number, rewards: object): Promise<number> {
        for (const r in rewards) {
            const reward = rewards[r];
            if (r == 'decrease_ship_fee') {
                const percent = _.parseFloatNull(reward['percent']) || 0;
                const max = _.parseIntNull(reward['max']) || Number.MAX_VALUE;
                
                const result = _.ceil((price * (percent / 100)), -3) || 0;
                return max > result ? result : max;
            }
        }
    }
}

export default PromotionServ;