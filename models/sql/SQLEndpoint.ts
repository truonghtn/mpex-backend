import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

import { ENDPOINT_STATUS } from '../../glob/cf';

@Table({tableName: 'tbl_endpoint'})
export class SQLEndpoint extends Model<SQLEndpoint> {

    @PrimaryKey
    @Column({type: DataType.TEXT, field: 'id'})
    id: string;

    @PrimaryKey
    @Column({type: DataType.TEXT, field: 'endpoint_code'})
    endpoint_code: string;

    @Column({type: DataType.TEXT, field: 'order_id'})
    order_id: string;

    @Column({type: DataType.INTEGER, field: 'address'})
    address: string;

    @Column({type: DataType.DECIMAL, field: 'lat'})
    lat: number;

    @Column({type: DataType.DECIMAL, field: 'lng'})
    lng: number;

    @Column({type: DataType.TEXT, field: 'customer_name'})
    customer_name: string;

    @Column({type: DataType.TEXT, field: 'customer_phone'})
    customer_phone: string;

    @Column({type: DataType.TEXT, field: 'customer_note'})
    customer_note: string;

    @Column({type: DataType.DECIMAL, field: 'deliv_fee'})
    deliv_fee: string;

    @Column({type: DataType.DECIMAL, field: 'cash_on_deliv'})
    cash_on_deliv: string;

    @Column({type: DataType.BOOLEAN, field: 'fragile'})
    fragile: boolean;

    @Column({type: DataType.TEXT, field: 'img'})
    img: string;

    @Column({type: DataType.DATE, field: 'created_at'})
    created_at: Date;

    @Column({type: DataType.DATE, field: 'updated_at'})
    updated_at: Date;

    @Column({type: DataType.TEXT, field: 'status'})
    status: ENDPOINT_STATUS;

    @Column({type: DataType.INTEGER, field: 'type'})
    type: number;

    @Column({type: DataType.TEXT, field: 'org_order_id'})
    org_order_id: string;

    @Column({type: DataType.BOOLEAN, field: 'deleted'})
    deleted: boolean;
}

export default SQLEndpoint;