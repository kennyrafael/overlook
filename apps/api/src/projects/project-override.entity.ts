import { Column, Entity, PrimaryColumn } from 'typeorm';

/** User edits layered on top of auto-discovered project data. */
@Entity('project_overrides')
export class ProjectOverrideEntity {
  @PrimaryColumn() id: string; // hash of project path
  @Column({ type: 'text', nullable: true }) name: string | null;
  @Column({ type: 'text', nullable: true }) status: string | null;
  @Column('simple-json', { default: '[]' }) tags: string[];
  @Column({ default: false }) pinned: boolean;
}
