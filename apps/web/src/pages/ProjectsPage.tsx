import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type DataTableExpandedRows } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { ProgressBar } from 'primereact/progressbar';
import { Tag } from 'primereact/tag';
import { Button } from 'primereact/button';
import { Toast } from 'primereact/toast';
import { Tooltip } from 'primereact/tooltip';
import type { Project, ProjectPatch } from '@overlook/shared';
import FilterBar from '../components/FilterBar';
import { filterProjects, useFilters } from '../store/filters';
import { useProjects } from '../store/projects';
import { relativeTime, sourceLabel, statusSeverity } from '../format';
import ProjectEditDialog from './ProjectEditDialog';
import { ProjectActionsMenu } from '../actions/projectActions';

export default function ProjectsPage() {
  const { projects, loaded, loading, rescan, update } = useProjects();
  const filters = useFilters();
  const [expanded, setExpanded] = useState<DataTableExpandedRows | undefined>();
  const [editing, setEditing] = useState<Project | null>(null);
  const toast = useRef<Toast>(null);

  const fail = (summary: string) => (e: unknown) =>
    toast.current?.show({ severity: 'error', summary, detail: e instanceof Error ? e.message : String(e) });

  const doRescan = async () => {
    try {
      const list = await rescan();
      toast.current?.show({ severity: 'success', summary: `Found ${list.length} projects` });
    } catch (e) {
      fail('Rescan failed')(e);
    }
  };

  const doUpdate = async (id: string, patch: ProjectPatch) => {
    try {
      await update(id, patch);
    } catch (e) {
      fail('Update failed')(e);
      throw e;
    }
  };

  const visible = useMemo(() => filterProjects(projects, filters), [projects, filters]);

  const nameBody = (p: Project) => (
    <div className="flex flex-column gap-1">
      <span className="font-semibold">
        <Link to={`/projects/${p.id}`} className="text-color no-underline hover:text-primary">{p.name}</Link>
        {!p.exists && <Tag className="ml-2" severity="danger" value="missing" />}
      </span>
      <small className="text-500 break-all">{p.path}</small>
      {p.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.tags.map((t) => (
            <Tag key={t} value={t} severity="secondary" rounded className="cursor-pointer"
              onClick={() => filters.toggle('tags', t)} />
          ))}
        </div>
      )}
    </div>
  );

  const statusBody = (p: Project) => (
    <Tag severity={statusSeverity[p.status]} value={p.status}
      icon={p.statusOverridden ? 'pi pi-lock' : undefined}
      className="cursor-pointer status-tag"
      data-pr-tooltip={p.statusOverridden ? 'Set manually · click to filter' : 'Derived from activity · click to filter'}
      onClick={() => filters.toggle('statuses', p.status)} />
  );

  const rowExpansion = (p: Project) => (
    <div className="grid p-2">
      <div className="col-12 md:col-4">
        <div className="text-500 mb-2">Detected by</div>
        <div className="flex flex-wrap gap-1">
          {p.markers.length ? p.markers.map((m) => <Tag key={m} value={m} severity="info" />) : <span>—</span>}
        </div>
        <div className="text-500 mt-3 mb-1">Source</div>
        <div>{sourceLabel[p.source]}</div>
        <div className="text-500 mt-3 mb-1">Plan files</div>
        <div>{p.planFiles.length ? p.planFiles.join(', ') : '—'}</div>
      </div>
      <div className="col-12 md:col-8">
        <div className="text-500 mb-2">Included folders ({p.subpaths.length})</div>
        {p.subpaths.length
          ? <ul className="m-0 pl-3">{p.subpaths.map((s) => <li key={s} className="break-all"><code>{s.slice(p.path.length) || s}</code></li>)}</ul>
          : <span>—</span>}
      </div>
    </div>
  );

  const header = (
    <div className="flex flex-column gap-2">
      <FilterBar />
      <div className="flex justify-content-end">
        <Button icon="pi pi-refresh" label="Rescan" outlined size="small" loading={loading} onClick={doRescan} />
      </div>
    </div>
  );

  return (
    <>
      <Toast ref={toast} />
      <Tooltip target=".status-tag" position="top" />
      <DataTable value={visible} loading={!loaded && loading} dataKey="id" header={header}
        emptyMessage={projects.length ? 'No projects match the filters.' : 'No projects found. Add a root folder in Settings, then Rescan.'}
        stripedRows removableSort sortMode="single" paginator rows={25} rowsPerPageOptions={[10, 25, 50]}
        expandedRows={expanded} onRowToggle={(e) => setExpanded(e.data as DataTableExpandedRows)}
        rowExpansionTemplate={rowExpansion}
        footer={`${visible.length} of ${projects.length} projects`}>
        <Column expander style={{ width: '3rem' }} />
        <Column style={{ width: '3rem' }} body={(p: Project) => (
          <Button icon={p.pinned ? 'pi pi-star-fill' : 'pi pi-star'} rounded text
            severity={p.pinned ? 'warning' : 'secondary'} aria-label={p.pinned ? 'Unpin' : 'Pin'}
            onClick={() => doUpdate(p.id, { pinned: !p.pinned }).catch(() => {})} />
        )} />
        <Column field="name" header="Project" sortable body={nameBody} />
        <Column field="status" header="Status" sortable body={statusBody} style={{ width: '9rem' }} />
        <Column field="progress" header="Progress" sortable style={{ width: '13rem' }}
          body={(p: Project) => (
            <div>
              <ProgressBar value={p.progress} style={{ height: '0.6rem' }} showValue={false} />
              <small className="text-500">
                {p.milestonesTotal
                  ? `${p.progress}% · ${p.milestonesReached}/${p.milestonesTotal} milestones · ${p.tasksDone}/${p.tasksTotal} tasks`
                  : 'No plan'}
              </small>
            </div>
          )} />
        <Column field="lastActivityAt" header="Last activity" sortable style={{ width: '9rem' }}
          body={(p: Project) => <span title={p.lastActivityAt ?? ''}>{relativeTime(p.lastActivityAt)}</span>} />
        <Column field="claudeSessions" header="Sessions" sortable style={{ width: '7rem' }}
          body={(p: Project) => <span><i className="pi pi-microchip-ai text-primary mr-1" />{p.claudeSessions}</span>} />
        <Column style={{ width: '4rem' }} body={(p: Project) => <ProjectActionsMenu project={p} />} />
        <Column style={{ width: '4rem' }} body={(p: Project) => (
          <Button icon="pi pi-pencil" rounded text aria-label="Edit" onClick={() => setEditing(p)} />
        )} />
      </DataTable>
      <ProjectEditDialog project={editing} onHide={() => setEditing(null)} onSave={doUpdate} />
    </>
  );
}
