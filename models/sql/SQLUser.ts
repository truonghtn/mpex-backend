import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

import * as CF from '../../glob/cf';

@Table({tableName: 'tbl_users'})
export class SQLUser extends Model<SQLUser> {

    @PrimaryKey
    @AutoIncrement
    @Column({type: DataType.INTEGER, field: 'id'})
    id: number;

    @Column({type: DataType.TEXT, field: 'first_name'})
    first_name: string;

    @Column({type: DataType.TEXT, field: 'last_name'})
    last_name: string;

    @Column({type: DataType.TEXT, field: 'phone'})
    phone: string;

    @Column({type: DataType.TEXT, field: 'email'})
    email: string;

    @Column({type: DataType.INTEGER, field: 'account_type'})
    account_type: number;

    @Column({type: DataType.TEXT, field: 'active_code'})
    active_code: string;

    @Column({type: DataType.INTEGER, field: 'role_id'})
    role_id: number;

    @Column({type: DataType.TEXT, field: 'driver_type'})
    driver_type: CF.DRIVER_TYPE;

    @Column({type: DataType.INTEGER, field: 'activated'})
    activated: number;
}

export default SQLUser;