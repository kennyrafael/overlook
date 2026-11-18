import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Plan progress of one project on one local day. */
@Entity('snapshots')
export class SnapshotEntity {
  @PrimaryColumn() projectId: string;
  @PrimaryColumn() day: string; // YYYY-MM-DD
  @Column('int') milestonesReached: number;
  @Column('int') milestonesTotal: number;
  @Column('int') tasksDone: number;
  @Column('int') tasksTotal: number;
  /** 'live' = recorded by the dashboard; 'git' = reconstructed from the plan file's git history. */
  @Column({ type: 'text', default: 'live' }) source: 'live' | 'git';
}
