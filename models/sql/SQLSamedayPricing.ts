import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

@Table({tableName: 'tbl_sameday_pricing'})
export class SQLSamedayPricing extends Model<SQLSamedayPricing> {

    @PrimaryKey
    @Column({type: DataType.TEXT, field: 'from_district'})
    from_district: string;

    @PrimaryKey
    @Column({type: DataType.TEXT, field: 'to_district'})
    to_district: string;

    @Column({type: DataType.DECIMAL, field: 'base_price'})
    base_price: number;

    @Column({type: DataType.DECIMAL, field: 'km_price'})
    km_price: number;

    @Column({type: DataType.DECIMAL, field: 'base_price_exceed'})
    base_price_exceed: number;

    @Column({type: DataType.DECIMAL, field: 'km_price_exceed'})
    km_price_exceed: number;

    @Column({type: DataType.DECIMAL, field: 'weight_price_exceed'})
    weight_price_exceed: number;
}

export default SQLSamedayPricing;