import * as moment from 'moment';
import * as bases from 'bases';
import * as pad from 'string-padding';

import HC from '../glob/hc';
import * as CF from '../glob/cf';
import { REDIS, FB } from '../glob/conn';
import _ from '../utils/_';
import { callAPI_TPS } from '../utils/call-request';

export interface ITransaction {
    user_id: number;
    amount: number;
    actor: string;
    actor_type: string;
    transaction_type: string;
    target: string;
    target_type: string;
    content: string;
    data: string;
}

export class AccountantServ {
    static execTransactions(transactions: ITransaction[]) {
        return callAPI_TPS('PUT', '/do-transactions', {
            transactions: transactions
        })
    }

    // Shipper nhận tiền COD từ người nhận
    static ship_cod_customer(driverId: number, COD: number, customer: number, userId: number): ITransaction[] {
        return [
            {
                user_id: driverId,
                amount: -COD,
                actor: driverId.toString(),
                actor_type: "SHIPPER",
                transaction_type: "NHAN_COD",
                target: "NGUOI NHAN",
                target_type: "NGUOI NHAN",
                content: "SHIPPER nhan COD tu NGUOI NHAN",
                data: ""
            },
            {
                user_id: userId,
                amount: COD,
                actor: driverId.toString(),
                actor_type: "NGUOI NHAN",
                transaction_type: "TRA_COD",
                target: driverId.toString(),
                target_type: "SHIPPER",
                content: "NGUOI NHAN tra COD SHIPPER",
                data: ""
            }
        ];
    }

    // Shipper nhận tiền ship từ người nhận
    static ship_fee_customer(driverId: number, driverType: CF.DRIVER_TYPE, orgDriverId: number, fee: number, customer: number, userId: number): ITransaction[] {
        const transactions: ITransaction[] = [{
            user_id: driverId,
            amount: -fee,
            actor: driverId.toString(),
            actor_type: "SHIPPER",
            transaction_type: "NHAN_SHIP",
            target: "NGUOI_NHAN",
            target_type: "NGUOI_NHAN",
            content: "SHIPPER nhan phi ship tu NGUOI NHAN",
            data: ""
        }];

        if (driverType == 'INHOUSE') {
            transactions.push({
                user_id: driverId,
                amount: HC.INHOUSE_SAMEDAY_DELIVER_COMMISSION,
                actor: driverId.toString(),
                actor_type: "SHIPPER",
                transaction_type: "NHAN_SHIP_SHARED",
                target: "NGUOI NHAN",
                target_type: "NGUOI NHAN",
                content: "SHIPPER nhan phi ship shared tu NGUOI NHAN",
                data: ""
            });

            transactions.push({
                user_id: orgDriverId,
                amount: HC.INHOUSE_SAMEDAY_PICKUP_COMMISSION,
                actor: orgDriverId.toString(),
                actor_type: "SHIPPER",
                transaction_type: "NHAN_SHIP_SHARED",
                target: "NGUOI NHAN",
                target_type: "NGUOI NHAN",
                content: "SHIPPER nhan phi ship shared tu NGUOI NHAN",
                data: ""
            });
        }
        else if (driverType == 'PARTTIME') {
            transactions.push({
                user_id: driverId,
                amount: HC.PARTTIME_SAMEDAY_DELIVER_COMMISSION,
                actor: driverId.toString(),
                actor_type: "SHIPPER",
                transaction_type: "NHAN_SHIP_SHARED",
                target: "NGUOI NHAN",
                target_type: "NGUOI NHAN",
                content: "SHIPPER nhan phi ship shared tu NGUOI NHAN",
                data: ""
            });

            transactions.push({
                user_id: orgDriverId,
                amount: HC.PARTTIME_SAMEDAY_PICKUP_COMMISSION,
                actor: orgDriverId.toString(),
                actor_type: "SHIPPER",
                transaction_type: "NHAN_SHIP_SHARED",
                target: "NGUOI NHAN",
                target_type: "NGUOI NHAN",
                content: "SHIPPER nhan phi ship shared tu NGUOI NHAN",
                data: ""
            });
        }
    
        return transactions;
    }

    // Shipper nhận trước tiền ship từ chủ shop
    static ship_fee_user(driverId: number, fee: number, customer: number, userId: number): ITransaction[] {
        return [
            {
                user_id: driverId,
                amount: -fee,
                actor: driverId.toString(),
                actor_type: "SHIPPER",
                transaction_type: "NHAN_SHIP",
                target: "SHOP",
                target_type: "SHOP",
                content: "SHIPPER nhan phi ship tu SHOP",
                data: ""
            }
        ];
    }

    // Shipper nhận tiền chạy ondemand từ người đặt
    static ondemand_fee_customer(driverId: number, driverType: CF.DRIVER_TYPE, fee: number, org_fee: number, userId: number): ITransaction[] {
        const transactions: ITransaction[] = [{
            user_id: driverId,
            amount: -fee,
            actor: driverId.toString(),
            actor_type: "SHIPPER",
            transaction_type: "NHAN_ONDEMAND_FEE",
            target: userId.toString(),
            target_type: "NGUOI_DAT",
            content: "SHIPPER nhan phi ondemand tu NGUOI_DAT",
            data: ""
        }];

        if (driverType == 'INHOUSE') {
            transactions.push({
                user_id: driverId,
                amount: _.ceil(HC.INHOUSE_ONDEMAND_SHARED_PERCENT * org_fee, -3),
                actor: driverId.toString(),
                actor_type: "SHIPPER",
                transaction_type: "NHAN_FEE_SHARED",
                target: "MPEX",
                target_type: "MPEX",
                content: "SHIPPER nhan phi ondemand tu MPEX",
                data: ""
            });
        }
        else if (driverType == 'PARTTIME') {
            transactions.push({
                user_id: driverId,
                amount: _.ceil(HC.PARTTIME_ONDEMAND_SHARED_PERCENT * org_fee, -3),
                actor: driverId.toString(),
                actor_type: "SHIPPER",
                transaction_type: "NHAN_FEE_SHARED",
                target: "MPEX",
                target_type: "MPEX",
                content: "SHIPPER nhan phi ondemand tu MPEX",
                data: ""
            });
        }
    
        return transactions;
    }

    // Còn 5 cái trường hợp bên open-apis nữa cần chuyển qua.
}

export default AccountantServ;