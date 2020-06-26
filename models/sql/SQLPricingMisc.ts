import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

@Table({tableName: 'tbl_pricing_misc'})
export class SQLPricingMisc extends Model<SQLPricingMisc> {

    @PrimaryKey
    @Column({type: DataType.TEXT, field: 'field'})
    field: string;

    @Column({type: DataType.TEXT, field: 'value'})
    value: string;
}

export default SQLPricingMisc;