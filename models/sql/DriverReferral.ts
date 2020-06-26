import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

import * as CF from '../../glob/cf';

@Table({tableName: 'tbl_driver_fererral'})
export class DriverReferral extends Model<DriverReferral> {

    @PrimaryKey
    @Column({type: DataType.INTEGER, field: 'driver_id'})
    driver_id: number;
    
    @Column({type: DataType.INTEGER, field: 'referral_id'})
    referral_id: number;
    
    @Column({type: DataType.INTEGER, field: 'next_reward'})
    next_reward: number;
    
    @Column({type: DataType.INTEGER, field: 'revenue'})
    revenue: number;
}

export default DriverReferral;