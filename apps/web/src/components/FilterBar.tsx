import { Chip } from 'primereact/chip';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { MultiSelect } from 'primereact/multiselect';
import { Checkbox } from 'primereact/checkbox';
import { PROJECT_STATUSES, type ProjectSource } from '@overlook/shared';
import { ACTIVITY_BUCKETS, activeFilterCount, useFilters } from '../store/filters';
import { useProjects } from '../store/projects';
import { sourceLabel } from '../format';
import ViewsControl from './ViewsControl';

const SOURCES: ProjectSource[] = ['root', 'claude', 'both'];

/** One row of global filters above the charts/table, plus removable chips for what is active. */
export default function FilterBar() {
  const f = useFilters();
  const projects = useProjects((s) => s.projects);
  const allTags = [...new Set(projects.flatMap((p) => p.tags))].sort();
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const activityLabel = (v: string) => ACTIVITY_BUCKETS.find((b) => b.value === v)?.label ?? v;

  const chips: { key: string; label: string; onRemove: () => void }[] = [
    ...f.projectIds.map((id) => ({ key: `p-${id}`, label: `Project: ${nameOf(id)}`, onRemove: () => f.toggle('projectIds', id) })),
    ...f.statuses.map((s) => ({ key: `s-${s}`, label: `Status: ${s}`, onRemove: () => f.toggle('statuses', s) })),
    ...f.tags.map((t) => ({ key: `t-${t}`, label: `Tag: ${t}`, onRemove: () => f.toggle('tags', t) })),
    ...f.sources.map((s) => ({ key: `o-${s}`, label: `Source: ${sourceLabel[s]}`, onRemove: () => f.toggle('sources', s) })),
    ...f.activity.map((a) => ({ key: `a-${a}`, label: `Activity: ${activityLabel(a)}`, onRemove: () => f.toggle('activity', a) })),
  ];

  return (
    <div className="flex flex-column gap-2">
      <div className="flex flex-wrap gap-2 align-items-center">
        <IconField iconPosition="left" className="flex-grow-1" style={{ minWidth: '12rem' }}>
          <InputIcon className="pi pi-search" />
          <InputText className="w-full" placeholder="Search name, path, tag…" value={f.search}
            onChange={(e) => f.set({ search: e.target.value })} />
        </IconField>
        <MultiSelect value={f.statuses} options={PROJECT_STATUSES} onChange={(e) => f.set({ statuses: e.value })}
          placeholder="Any status" maxSelectedLabels={2} selectedItemsLabel="{0} statuses" style={{ minWidth: '10rem' }} />
        <MultiSelect value={f.activity} options={ACTIVITY_BUCKETS} onChange={(e) => f.set({ activity: e.value })}
          placeholder="Any activity" maxSelectedLabels={1} selectedItemsLabel="{0} periods" style={{ minWidth: '10rem' }} />
        <MultiSelect value={f.sources} options={SOURCES.map((s) => ({ label: sourceLabel[s], value: s }))}
          onChange={(e) => f.set({ sources: e.value })} placeholder="Any source" maxSelectedLabels={1}
          selectedItemsLabel="{0} sources" style={{ minWidth: '10rem' }} />
        {allTags.length > 0 && (
          <MultiSelect value={f.tags} options={allTags} onChange={(e) => f.set({ tags: e.value })}
            placeholder="Any tag" maxSelectedLabels={2} selectedItemsLabel="{0} tags" style={{ minWidth: '9rem' }} />
        )}
        <ViewsControl />
        <div className="flex align-items-center gap-2">
          <Checkbox inputId="planned-only" checked={f.plannedOnly} onChange={(e) => f.set({ plannedOnly: !!e.checked })} />
          <label htmlFor="planned-only" className="cursor-pointer">With a plan</label>
        </div>
      </div>
      {activeFilterCount(f) > 0 && (
        <div className="flex flex-wrap gap-2 align-items-center">
          {chips.map((c) => <Chip key={c.key} label={c.label} removable onRemove={() => { c.onRemove(); return false; }} />)}
          <Button label="Clear all" icon="pi pi-filter-slash" text size="small" onClick={() => f.clear()} />
        </div>
      )}
    </div>
  );
}
