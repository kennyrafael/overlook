import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dropdown } from 'primereact/dropdown';
import { Message } from 'primereact/message';
import { Skeleton } from 'primereact/skeleton';
import type { ProjectDetail } from '@overlook/shared';
import { api } from '../api';
import { useProjects } from '../store/projects';
import { useFilters } from '../store/filters';
import TaskBoard from '../tasks/TaskBoard';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';

const ALL = '__all__';

export default function BoardPage() {
  const { projects, loaded } = useProjects();
  const selectedFromFilters = useFilters((s) => s.projectIds);
  const planned = useMemo(() => projects.filter((p) => p.milestonesTotal > 0), [projects]);
  const [choice, setChoice] = useState<string | null>(null);
  const [details, setDetails] = useState<ProjectDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default: the project picked in the global filter, else all projects with a plan.
  useEffect(() => {
    if (choice !== null || !loaded) return;
    const fromFilter = selectedFromFilters.find((id) => planned.some((p) => p.id === id));
    setChoice(fromFilter ?? (planned.length === 1 ? planned[0].id : ALL));
  }, [choice, loaded, planned, selectedFromFilters]);

  const ids = useMemo(() => (choice === ALL ? planned.map((p) => p.id) : choice ? [choice] : []), [choice, planned]);
  const idsKey = ids.join(',');

  const load = useCallback(() => {
    if (!ids.length) { setDetails([]); return; }
    setError(null);
    Promise.all(ids.map((id) => api.project(id)))
      .then(setDetails)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => { setDetails(null); load(); }, [load]);

  const liveKey = useLive((s) => ids.map((i) => s.projects[i] ?? 0).join(','));
  useOnChange(liveKey, load);

  const onProjectChanged = useCallback((p: ProjectDetail) => {
    setDetails((ds) => ds?.map((d) => (d.id === p.id ? p : d)) ?? ds);
  }, []);

  if (!loaded) return <Skeleton height="20rem" />;
  if (!planned.length) {
    return <Message severity="info" text="No project has a plan yet. Add checklists under headings in PLAN.md, ROADMAP.md or TODO.md." />;
  }

  const options = [
    { label: `All projects with a plan (${planned.length})`, value: ALL },
    ...planned.map((p) => ({ label: `${p.name} · ${p.progress}%`, value: p.id })),
  ];

  return (
    <div className="flex flex-column gap-3">
      <div className="flex flex-wrap align-items-center gap-3">
        <Dropdown value={choice} options={options} onChange={(e) => setChoice(e.value)} filter style={{ minWidth: '18rem' }} />
        {choice && choice !== ALL && <Link to={`/projects/${choice}`} className="text-primary no-underline">Open project <i className="pi pi-arrow-right text-sm" /></Link>}
        <small className="text-500 ml-auto">Drag cards between columns · changes are written to the plan file</small>
      </div>
      {error && <Message severity="error" text={error} />}
      {!details ? <Skeleton height="20rem" /> : <TaskBoard projects={details} onProjectChanged={onProjectChanged} onConflict={load} />}
    </div>
  );
}
