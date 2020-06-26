import * as moment from 'moment';

import { FB } from '../glob/conn';
import * as ENV from '../glob/env';
import ERR from '../glob/err';

import _ from '../utils/_';

import { SQLPricingMisc } from '../models/sql/SQLPricingMisc';
import { SQLDistrict } from '../models/sql/SQLDistrict';
import { SQLSamedayPricing } from '../models/sql/SQLSamedayPricing';

export interface IPricingContext {
    from_district: number;
    to_district: number;
    weight: number;
    fragile: boolean;
    COD: number;
    is_document: number;
}

export class PricingServ {
    static calcPricing(ctx: IPricingContext) {
        if (ctx.is_document) {
            return this.calcDocumentPricing(ctx);
        }
        else {
            return this.calcSamedayPricing(ctx);
        }
    }

    static async calcSamedayPricing(ctx: IPricingContext) {

        const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
        const FREE_KM = parseFloat(_.find(pricingMisc, {'field': 'FREE_KM'}).value);
        const FREE_WEIGHT = parseFloat(_.find(pricingMisc, {'field': 'FREE_WEIGHT'}).value);
        const SAMEDAY_HOUR = parseInt(_.find(pricingMisc, {'field': 'SAMEDAY_HOUR'}).value);
        const FEE_SAMEDAY = parseInt(_.find(pricingMisc, {'field': 'FEE_SAMEDAY'}).value);
        const FRAGILE = parseInt(_.find(pricingMisc, {'field': 'FRAGILE'}).value);

        const MAX_COD_1 = parseInt(_.find(pricingMisc, {'field': 'MAX_COD_1'}).value);
        const MAX_COD_2 = parseInt(_.find(pricingMisc, {'field': 'MAX_COD_2'}).value);
        const FEE_COD_1 = parseInt(_.find(pricingMisc, {'field': 'FEE_COD_1'}).value);
        const FEE_COD_2 = parseInt(_.find(pricingMisc, {'field': 'FEE_COD_2'}).value);

        const VAT_FEE = parseFloat(_.find(pricingMisc, {'field': 'VAT_FEE'}).value);
        const SUB_FEE = parseFloat(_.find(pricingMisc, {'field': 'SUB_FEE'}).value);

        const from_district = await SQLDistrict.find<SQLDistrict>({where: {id: ctx.from_district}, attributes: ['id']});
        if (from_district == undefined || from_district == null) {
            throw _.logicError('Could not find district', `District ${ctx.from_district} not found`, 400, ERR.OBJECT_NOT_FOUND, ctx.from_district);
        }
        const to_district = await SQLDistrict.find<SQLDistrict>({where: {id: ctx.to_district}, attributes: ['id']});
        if (to_district == undefined || to_district == null) {
            throw _.logicError('Could not find district', `District ${ctx.to_district} not found`, 400, ERR.OBJECT_NOT_FOUND, ctx.to_district);
        }

        const weight = ctx.weight;
        // SAMEDAY
        const nowHour = moment().hour();
        const is_sameday = nowHour < SAMEDAY_HOUR;

        const sameday_pricing = await SQLSamedayPricing.find<SQLSamedayPricing>({
            where: {
                from_district: from_district.id,
                to_district: to_district.id
            }
        });

        if (sameday_pricing == undefined || sameday_pricing == null) {
            throw _.logicError('Could not find config pricing', `Config not found`, 400, ERR.OBJECT_NOT_FOUND);
        }

        let extraKMFee = 0;

        let extraWeightFee = 0;
        if (weight > FREE_WEIGHT) {
            extraWeightFee = (weight - FREE_WEIGHT) *  sameday_pricing.weight_price_exceed;
        }

        let extraEndpoint = 0;
        if (weight > FREE_WEIGHT){
            extraEndpoint = sameday_pricing.base_price_exceed;
        }

        let samedayFee = 0;
        if (is_sameday){
            samedayFee = FEE_SAMEDAY;
        }

        let fragileFee = 0;
        if (ctx.fragile){
            fragileFee = FRAGILE;
        }

        let codFee = 0;
        if (ctx.COD > MAX_COD_1 && ctx.COD < MAX_COD_2){
            codFee = FEE_COD_1;
        }
        if (ctx.COD > MAX_COD_2){
            codFee = FEE_COD_2;
        }

        const totalFee = sameday_pricing.base_price + extraEndpoint + extraKMFee + extraWeightFee + samedayFee + fragileFee +codFee;

        const delivfee = totalFee + totalFee * (VAT_FEE + SUB_FEE);

        return delivfee;
    }

    static async calcDocumentPricing(ctx: IPricingContext) {
        const pricingMisc = await SQLPricingMisc.findAll<SQLPricingMisc>();
        const URBAN = parseFloat(_.find(pricingMisc, {'field': 'DOC_URBAN_FEE'}).value);
        const SUBURBAN = parseFloat(_.find(pricingMisc, {'field': 'DOC_SUBURBAN_FEE'}).value);
        const URBAN_EXCEED = parseInt(_.find(pricingMisc, {'field': 'DOC_URBAN_EXCEED_FEE'}).value);
        const SUBURBAN_EXCEED = parseInt(_.find(pricingMisc, {'field': 'DOC_SUBURBAN_EXCEED_FEE'}).value);

        const from_district = await SQLDistrict.find<SQLDistrict>({where: {id: ctx.from_district}});
        if (from_district == undefined || from_district == null) {
            throw _.logicError('Could not find district', `District ${ctx.from_district} not found`, 400, ERR.OBJECT_NOT_FOUND, ctx.from_district);
        }

        const to_district = await SQLDistrict.find<SQLDistrict>({where: {id: ctx.to_district}});
        if (to_district == undefined || to_district == null) {
            throw _.logicError('Could not find district', `District ${ctx.to_district} not found`, 400, ERR.OBJECT_NOT_FOUND, ctx.to_district);
        }

        const isSubUrban = (from_district.area != 'UB') || (to_district.area != 'UB');

        const isExceed = ctx.weight >= 0.25;

        if (isSubUrban) {
            if (isExceed) {
                return SUBURBAN_EXCEED;
            }
            else {
                return SUBURBAN;
            }
        }
        else {
            if (isExceed) {
                return URBAN_EXCEED;
            }
            else {
                return URBAN;
            }
        }
    }
}