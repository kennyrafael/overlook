import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Summary of one Claude session log, valid while its size and mtime are unchanged. */
@Entity('parse_cache')
export class ParseCacheEntity {
  @PrimaryColumn() file: string;
  @Column('integer') size: number;
  @Column('real') mtimeMs: number;
  /** Parser version that wrote the row; rows from other versions are re-parsed. */
  @Column('integer') version: number;
  @Column('text') summary: string; // JSON LogSummary
}
