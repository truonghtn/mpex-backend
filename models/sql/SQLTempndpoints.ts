import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

@Table({tableName: 'temp_endpoints'})
export class SQLTempOrder extends Model<SQLTempOrder> {

    @PrimaryKey
    @Column({type: DataType.TEXT, field: 'id'})
    id: string;

    @PrimaryKey
    @Column({type: DataType.TEXT, field: 'content'})
    content: string;
}

export default SQLTempOrder;