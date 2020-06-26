import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

@Table({tableName: 'tbl_order'})
export class SQLOrder extends Model<SQLOrder> {

    @PrimaryKey
    @Column({type: DataType.TEXT, field: 'id'})
    id: string;

    @Column({type: DataType.INTEGER, field: 'userid'})
    userid: number;

    @Column({type: DataType.INTEGER, field: 'rating'})
    rating: number;

    @Column({type: DataType.TEXT, field: 'rating_note'})
    rating_note: string;

    @Column({type: DataType.DATE, field: 'updated_at'})
    updated_at: Date;
}

export default SQLOrder;