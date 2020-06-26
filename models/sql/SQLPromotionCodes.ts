import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

@Table({tableName: 'promotion_codes'})
export class SQLPromotionCodes extends Model<SQLPromotionCodes> {

    @PrimaryKey
    @AutoIncrement
    @Column({type: DataType.INTEGER, field: 'id'})
    id: number;

    @Column({type: DataType.STRING, field: 'code'})
    code: string;

    @Column({type: DataType.BOOLEAN, field: 'enabled'})
    enabled: boolean;

    @Column({type: DataType.DATE, field: 'expired'})
    expired: Date;

    @Column({type: DataType.TEXT, field: 'contraints'})
    contraints: string;

    @Column({type: DataType.TEXT, field: 'rewards'})
    rewards: string;

    @Column({type: DataType.TEXT, field: 'description'})
    description: string;

    constructor(json: any) {
        super();
        Object.assign(this, json);
    }
}

export default SQLPromotionCodes;