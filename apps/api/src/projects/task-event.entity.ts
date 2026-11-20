import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/** One plan task that changed between two reads of a project's plan files. */
@Entity('task_events')
@Index('IDX_task_events_at', ['at'])
export class TaskEventEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column('varchar') projectId: string;
  /** Plan file relative to the project folder. */
  @Column('text') file: string;
  @Column('text') taskText: string;
  /** null = the task appeared. */
  @Column({ type: 'varchar', nullable: true }) from: string | null;
  /** null = the task disappeared. */
  @Column({ type: 'varchar', nullable: true }) to: string | null;
  /** ISO timestamp (UTC), so string order is time order. */
  @Column('varchar') at: string;
  @Column({ type: 'varchar', default: 'file' }) source: 'file' | 'dashboard';
}

/** The last task list seen for a project, so changes made while the app was closed are found on the next read. */
@Entity('task_states')
export class TaskStateEntity {
  @PrimaryColumn('varchar') projectId: string;
  /** JSON TaskState[]. */
  @Column('text') tasks: string;
  @Column('varchar') updatedAt: string;
}
