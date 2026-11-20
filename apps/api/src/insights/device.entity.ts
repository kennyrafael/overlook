import { Column, Entity, PrimaryColumn } from 'typeorm';

/** A browser or app window that opened the dashboard (random id kept in its localStorage). */
@Entity('devices')
export class DeviceEntity {
  @PrimaryColumn('varchar') id: string;
  /** Last "Mark as seen" (ISO, UTC). */
  @Column('varchar') lastSeenAt: string;
}
