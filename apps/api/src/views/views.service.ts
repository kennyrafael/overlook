import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PROJECT_STATUSES, type SavedView, type ViewFilters } from '@overlook/shared';
import { ViewEntity } from './view.entity';

const SOURCES = ['root', 'claude', 'both'];
const strings = (v: unknown, allowed?: string[]) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && (!allowed || allowed.includes(x))))].slice(0, 200) : [];

/** Keeps only known filter fields with the right types. */
export function cleanFilters(raw: unknown): ViewFilters {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    search: typeof f.search === 'string' ? f.search.slice(0, 200) : '',
    statuses: strings(f.statuses, PROJECT_STATUSES) as ViewFilters['statuses'],
    tags: strings(f.tags),
    sources: strings(f.sources, SOURCES) as ViewFilters['sources'],
    activity: strings(f.activity, ['today', 'week', 'month', 'quarter', 'older', 'never']),
    projectIds: strings(f.projectIds),
    plannedOnly: f.plannedOnly === true,
  };
}

function cleanName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim().slice(0, 80) : '';
  if (!n) throw new BadRequestException('A view needs a name');
  return n;
}

const toView = (e: ViewEntity): SavedView => ({ id: e.id, name: e.name, filters: cleanFilters(JSON.parse(e.filters)), createdAt: e.createdAt.toISOString() });

@Injectable()
export class ViewsService {
  constructor(@InjectRepository(ViewEntity) private repo: Repository<ViewEntity>) {}

  async list(): Promise<SavedView[]> {
    return (await this.repo.find({ order: { name: 'ASC' } })).map(toView);
  }

  async create(body: { name?: unknown; filters?: unknown }): Promise<SavedView> {
    const e = this.repo.create({ name: cleanName(body?.name), filters: JSON.stringify(cleanFilters(body?.filters)) });
    return toView(await this.repo.save(e));
  }

  async update(id: string, body: { name?: unknown; filters?: unknown }): Promise<SavedView> {
    const e = await this.repo.findOneBy({ id });
    if (!e) throw new NotFoundException('View not found');
    if (body?.name !== undefined) e.name = cleanName(body.name);
    if (body?.filters !== undefined) e.filters = JSON.stringify(cleanFilters(body.filters));
    return toView(await this.repo.save(e));
  }

  async remove(id: string): Promise<{ ok: true }> {
    const r = await this.repo.delete({ id });
    if (!r.affected) throw new NotFoundException('View not found');
    return { ok: true };
  }
}
