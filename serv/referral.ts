import { SEQ } from '../glob/conn';
import HC from '../glob/hc';

import _ from '../utils/_';

import DriverReferral from '../models/sql/DriverReferral';
import SQLUser from '../models/sql/SQLUser';

import { ITransaction, AccountantServ } from './accountant';

export class ReferralServ {
    static async initReferral(userId: number, userType: number, referrerPhone: string) {
        console.log("Init referral");
        if (_.isEmpty(referrerPhone)) {
            return false;
        }

        const referrer = await SQLUser.findOne<SQLUser>({where: {phone: referrerPhone}});
        if (_.isEmpty(referrer)) {
            return false;
        }

        console.log(`Referrer found: ${referrer.id}`);
        if (userType == 2 && referrer.account_type == 2) {
            console.log(`Init driver referrer`);
            await DriverReferral.create({
                driver_id: userId,
                referral_id: referrer.id,
                next_reward: HC.REFERRAL_RANGE,
                revenue: 0
            });
        }
        else {
            console.log(`Init user referrer`);
            const transactions: ITransaction[] = [];
            if (userType == 1) {
                console.log(`Add reward for the new user`);
                transactions.push({
                    user_id: userId,
                    amount: HC.USER_REFERRAL_REWARD,
                    actor: referrer.id.toString(),
                    actor_type: referrer.account_type == 1 ? "USER" : "SHIPPER",
                    transaction_type: "USER_REFERRAL_REWARD",
                    target: userId.toString(),
                    target_type: referrer.account_type == 1 ? "USER" : "SHIPPER",
                    content: "Chao mung den voi MPEX",
                    data: ""
                });
            }

            if (referrer.account_type == 1) {
                console.log(`Add reward for referrer`);
                transactions.push({
                    user_id: referrer.id,
                    amount: HC.USER_REFERRAL_REWARD,
                    actor: referrer.id.toString(),
                    actor_type: referrer.account_type == 1 ? "USER" : "SHIPPER",
                    transaction_type: "USER_REFERRAL_REWARD",
                    target: userId.toString(),
                    target_type: referrer.account_type == 1 ? "USER" : "SHIPPER",
                    content: "Thuong gioi thieu khach hang",
                    data: ""
                });
            }
            

            console.log(`Exec transactions`);
            await AccountantServ.execTransactions(transactions);
            console.log(`Finish transactions`);
        }
        
        return true;
    }

    static async updateTransactions(transactions: ITransaction[]) {
        return Promise.all(transactions.map(tr => this.updateReferal(tr.user_id, tr.amount)));
    }

    static async updateReferal(driverId: number, amount: number) {
        await DriverReferral.update({revenue: SEQ.literal(`revenue + ${amount}`)}, {where: {driver_id: driverId}});
        const referral = await DriverReferral.findOne<DriverReferral>({where: {driver_id: driverId}});

        const referralTransactions: ITransaction[] = [];
        let nextReward = referral.next_reward

        while (referral.revenue >= referral.next_reward) {
            if (referral.referral_id != null) {
                const reward = _.ceil(HC.REFERRAL_RATIO * HC.REFERRAL_RANGE, -3);
                referralTransactions.push({
                    user_id: referral.referral_id,
                    amount: reward,
                    actor: driverId.toString(),
                    actor_type: "SHIPPER",
                    transaction_type: "REFERRAL_REWARD",
                    target: referral.referral_id.toString(),
                    target_type: "SHIPPER",
                    content: "Hoa hong gioi thieu nhan vie",
                    data: ""
                });
            }

            // update next_reward
            nextReward += HC.REFERRAL_RANGE;
        }

        if (referralTransactions.length > 0) {
            await AccountantServ.execTransactions(referralTransactions);
        }

        if (nextReward != referral.next_reward) {
            await DriverReferral.update({next_reward: nextReward}, {where: {driver_id: driverId}});
        }
    }
}

export default ReferralServ;