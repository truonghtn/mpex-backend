import {Table, Column, Model, DataType, PrimaryKey, AutoIncrement} from 'sequelize-typescript';

@Table({tableName: 'tbl_district'})
export class SQLDistrict extends Model<SQLDistrict> {

    @PrimaryKey
    @Column({type: DataType.INTEGER, field: 'id'})
    id: number;

    @Column({type: DataType.INTEGER, field: 'id_city'})
    id_city: number;

    @Column({type: DataType.TEXT, field: 'name'})
    name: string;

    @Column({type: DataType.TEXT, field: 'name_sort'})
    name_sort: string;

    @Column({type: DataType.DECIMAL, field: 'price'})
    price: number;
    
    @Column({type: DataType.TEXT, field: 'area'})
    area: string;
}

export default SQLDistrict;