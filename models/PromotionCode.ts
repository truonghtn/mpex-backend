
import { SQLPromotionCodes } from "./sql/SQLPromotionCodes";

interface IPromotionCode {
    promotionCode(objCode: SQLPromotionCodes);
}

export class PromotionStrategy {
    public Strategy: IPromotionCode;

    constructor(strategy: IPromotionCode){
        this.Strategy = strategy;
    }

    public PromotionCode(objCode: SQLPromotionCodes){
        return this.Strategy.promotionCode(objCode);
    }
}

export class PromotionByPercent implements IPromotionCode {
    promotionCode(objCode: SQLPromotionCodes) {
        
    }
}

export class PromotionDetermined implements IPromotionCode {
    promotionCode(objCode: SQLPromotionCodes) {
        
    }
}