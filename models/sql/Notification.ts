import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

import * as CF from '../../glob/cf';

@Table({tableName: 'notification'})
export class Notification extends Model<Notification> {

    @PrimaryKey
    @AutoIncrement
    @Column({type: DataType.INTEGER, field: 'id'})
    id: number;

    @PrimaryKey
    @Column({type: DataType.INTEGER, field: 'user_id'})
    user_id: number;
    
    @Column({type: DataType.DATE, field: 'time'})
    time: number;
    
    @Column({type: DataType.TEXT, field: 'type'})
    type: string;
    
    @Column({type: DataType.TEXT, field: 'content'})
    content: string;
    
    @Column({type: DataType.TEXT, field: 'data'})
    data: string;
    
}

export default Notification;