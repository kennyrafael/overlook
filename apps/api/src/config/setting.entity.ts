import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('settings')
export class SettingEntity {
  @PrimaryColumn() key: string;
  @Column('text') value: string; // JSON
}
