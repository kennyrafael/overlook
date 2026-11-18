import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('views')
export class ViewEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column('text') filters: string; // JSON ViewFilters
  @CreateDateColumn() createdAt: Date;
}
