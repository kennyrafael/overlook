import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import TaskBoard from '../tasks/TaskBoard';
import GitInsights from '../insights/GitInsights';
import ClaudeInsights from '../insights/ClaudeInsights';
import ProgressChart from '../insights/ProgressChart';
import { ProjectActionsButton } from '../actions/projectActions';
import { useTaskActions } from '../tasks/useTaskActions';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';
import { Link, useParams } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import { Knob } from 'primereact/knob';
import { TabView, TabPanel } from 'primereact/tabview';
import { Accordion, AccordionTab } from 'primereact/accordion';
import { ProgressBar } from 'primereact/progressbar';
import { SelectButton } from 'primereact/selectbutton';
import { InputText } from 'primereact/inputtext';
import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { Chart } from 'primereact/chart';
import { Message } from 'primereact/message';
import { Skeleton } from 'primereact/skeleton';
import type { Milestone, ProjectDetail, Task } from '@overlook/shared';
import { api } from '../api';
import { relativeTime, sourceLabel, statusSeverity } from '../format';
import { baseOptions, chartTokens } from '../chartTheme';
import { useTheme } from '../theme/ThemeContext';

type MilestoneFilter = 'all' | 'open' | 'reached';

const TASK_ICON: Record<Task['status'], string> = {
  done: 'pi pi-check-square text-green-500',
  in_progress: 'pi pi-spinner text-yellow-500',
  todo: 'pi pi-stop text-500',
};

function AddTaskInline({ onAdd }: { onAdd: (text: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (await onAdd(text)) { setText(''); setOpen(false); }
    } finally {
      setBusy(false);
    }
  };
  if (!open) return <Button label="Add task" icon="pi pi-plus" text size="small" className="mt-2" onClick={() => setOpen(true)} />;
  return (
    <div className="flex gap-2 mt-3">
      <InputText className="flex-grow-1" autoFocus value={text} placeholder="New task…" disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false); }} />
      <Button icon="pi pi-check" aria-label="Add" loading={busy} disabled={!text.trim()} onClick={submit} />
      <Button icon="pi pi-times" aria-label="Cancel" text onClick={() => setOpen(false)} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-column gap-1">
      <span className="text-500 text-sm">{label}</span>
      <span className="text-2xl font-bold">{value}</span>
      {sub && <small className="text-500">{sub}</small>}
    </div>
  );
}

function MilestoneHeader({ m }: { m: Milestone }) {
  const pct = m.tasksTotal ? Math.round((m.tasksDone / m.tasksTotal) * 100) : m.reached ? 100 : 0;
  return (
    <div className="flex align-items-center gap-3 w-full">
      <i className={m.reached ? 'pi pi-flag-fill text-green-500' : 'pi pi-flag text-500'} />
      <div className="flex-grow-1 min-w-0">
        <div className="font-semibold white-space-nowrap overflow-hidden text-overflow-ellipsis">{m.title}</div>
        <small className="text-500">{[...m.breadcrumb.slice(-1), m.relFile].join(' · ')}</small>
      </div>
      <div style={{ width: '8rem' }} className="hidden md:block">
        <ProgressBar value={pct} showValue={false} style={{ height: '0.4rem' }} />
      </div>
      <Tag value={m.tasksTotal ? `${m.tasksDone}/${m.tasksTotal}` : m.reached ? 'done' : 'open'}
        severity={m.reached ? 'success' : m.tasksInProgress ? 'warning' : 'secondary'} />
    </div>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { version: themeVersion } = useTheme();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MilestoneFilter>('all');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<number[]>([]);

  const reload = useCallback(() => {
    if (id) api.project(id).then(setProject).catch((e) => setError(String(e)));
  }, [id]);

  useEffect(() => {
    setProject(null);
    reload();
  }, [reload]);

  const liveVersion = useLive((s) => (id ? s.projects[id] ?? 0 : 0));
  useOnChange(liveVersion, reload);

  const actions = useTaskActions(setProject, reload);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const toggleTask = async (t: Task) => {
    if (!project) return;
    setBusyTask(t.id);
    try {
      await actions.setStatus(project.id, t, t.status === 'done' ? 'todo' : 'done');
    } finally {
      setBusyTask(null);
    }
  };

  const milestones = useMemo(() => {
    if (!project) return [];
    const q = query.trim().toLowerCase();
    return project.milestones
      .filter((m) => filter === 'all' || (filter === 'reached' ? m.reached : !m.reached))
      .map((m) => (q ? { ...m, tasks: m.tasks.filter((t) => t.text.toLowerCase().includes(q)) } : m))
      .filter((m) => !q || m.tasks.length || m.title.toLowerCase().includes(q));
  }, [project, filter, query]);

  // Expand everything while searching so matches are visible; collapse when the search is cleared.
  const searching = query.trim() !== '';
  const focusAfterClear = useRef<number | null>(null);
  useEffect(() => {
    if (searching) {
      setActive(milestones.map((_, i) => i));
    } else {
      setActive(focusAfterClear.current !== null ? [focusAfterClear.current] : []);
      focusAfterClear.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, searching && milestones]);

  const chart = useMemo(() => {
    if (!project) return null;
    const t = chartTokens();
    const ms = project.milestones.filter((m) => m.tasksTotal);
    const ds = (label: string, color: string, pick: (m: Milestone) => number) => ({
      label, backgroundColor: color, borderColor: t.surface, borderWidth: { right: 2 },
      borderRadius: 4, borderSkipped: false, barThickness: 14, data: ms.map(pick),
    });
    const opts = baseOptions(t);
    return {
      data: {
        labels: ms.map((m) => (m.title.length > 34 ? m.title.slice(0, 33) + '…' : m.title)),
        datasets: [
          ds('Done', t.done, (m) => m.tasksDone),
          ds('In progress', t.inProgress, (m) => m.tasksInProgress),
          ds('To do', t.todo, (m) => m.tasksTotal - m.tasksDone - m.tasksInProgress),
        ],
      },
      options: {
        ...opts,
        indexAxis: 'y',
        plugins: { ...opts.plugins, legend: { ...opts.plugins.legend, position: 'top', align: 'start' } },
        scales: {
          x: { ...opts.scales.x, stacked: true, ticks: { ...opts.scales.x.ticks, precision: 0 } },
          y: { ...opts.scales.y, stacked: true },
        },
        onClick: (_: unknown, els: { index: number }[]) => {
          if (!els.length) return;
          const idx = project.milestones.indexOf(ms[els[0].index]);
          setFilter('all');
          focusAfterClear.current = idx;
          setQuery('');
          setActive([idx]);
        },
      },
      height: Math.max(160, ms.length * 34 + 60),
    };
    // Recompute colours when the theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, themeVersion]);

  if (error) return <Message severity="error" text={error} />;
  if (!project) return <Skeleton height="12rem" />;

  const p = project;
  return (
    <div className="flex flex-column gap-3">
      <Link to="/projects" className="text-primary no-underline"><i className="pi pi-arrow-left mr-2" />All projects</Link>

      <Card>
        <div className="flex flex-wrap align-items-center gap-4">
          <Knob value={p.progress} readOnly size={96} valueTemplate="{value}%" />
          <div className="flex-grow-1 min-w-0">
            <div className="flex align-items-center gap-2 flex-wrap">
              <h2 className="m-0">{p.name}</h2>
              <Tag severity={statusSeverity[p.status]} value={p.status} icon={p.statusOverridden ? 'pi pi-lock' : undefined} />
              {p.pinned && <i className="pi pi-star-fill text-yellow-500" />}
              {p.tags.map((t) => <Tag key={t} value={t} severity="secondary" rounded />)}
            </div>
            <small className="text-500 break-all">{p.path}</small>
          </div>
          <div className="flex flex-wrap gap-5">
            <Stat label="Milestones" value={`${p.milestonesReached}/${p.milestonesTotal}`} sub="reached" />
            <Stat label="Tasks" value={`${p.tasksDone}/${p.tasksTotal}`} sub="done" />
            <Stat label="Claude sessions" value={p.claudeSessions} sub={sourceLabel[p.source]} />
            <Stat label="Last activity" value={relativeTime(p.lastActivityAt)} />
          </div>
          <ProjectActionsButton project={p} />
        </div>
      </Card>

      <TabView>
        <TabPanel header="Milestones" leftIcon="pi pi-flag mr-2">
          {!p.milestonesTotal ? (
            <Message severity="info" className="w-full justify-content-start"
              text={`No milestones found. Add checklists under headings in one of: ${['PLAN.md', 'ROADMAP.md', 'TODO.md'].join(', ')}.`} />
          ) : (
            <div className="grid">
              <div className="col-12">
                <ProgressChart projectIds={[p.id]} title="Burnup" />
              </div>
              {chart && chart.data.labels.length > 0 && (
                <div className="col-12 xl:col-5">
                  <Card title="Tasks per milestone" subTitle="Click a bar to open that milestone">
                    <div style={{ height: chart.height }}>
                      <Chart type="bar" data={chart.data} options={chart.options} style={{ height: '100%' }} />
                    </div>
                  </Card>
                </div>
              )}
              <div className="col-12 xl:col-7">
                <div className="flex flex-wrap gap-2 mb-3">
                  <SelectButton value={filter} onChange={(e) => setFilter(e.value ?? 'all')}
                    options={[{ label: 'All', value: 'all' }, { label: 'Open', value: 'open' }, { label: 'Reached', value: 'reached' }]} />
                  <IconField iconPosition="left" className="flex-grow-1">
                    <InputIcon className="pi pi-search" />
                    <InputText className="w-full" placeholder="Search tasks…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </IconField>
                </div>
                {milestones.length === 0 ? <p className="text-500">No milestones match.</p> : (
                  <Accordion multiple activeIndex={active} onTabChange={(e) => setActive(e.index as number[])}>
                    {milestones.map((m) => (
                      <AccordionTab key={m.id} header={<MilestoneHeader m={m} />}>
                        {m.tasks.length === 0 ? <div className="text-500 mb-2">No tasks — marked {m.reached ? 'done' : 'open'} in the heading.</div> : (
                          <ul className="list-none m-0 p-0 flex flex-column gap-2">
                            {m.tasks.map((t) => (
                              <li key={t.id} className="flex gap-2 align-items-start" style={{ paddingLeft: `${t.depth * 1.25}rem` }}>
                                <button type="button" className="task-toggle" disabled={busyTask === t.id}
                                  aria-label={t.status === 'done' ? 'Mark as to do' : 'Mark as done'}
                                  title={t.status === 'done' ? 'Mark as to do' : 'Mark as done'}
                                  onClick={() => toggleTask(t)}>
                                  <i className={busyTask === t.id ? 'pi pi-spin pi-spinner text-500' : TASK_ICON[t.status]} />
                                </button>
                                <span className={t.status === 'done' ? 'line-through text-500' : ''}>{t.text}</span>
                                <small className="text-500 ml-auto white-space-nowrap">L{t.line}</small>
                              </li>
                            ))}
                          </ul>
                        )}
                        <AddTaskInline onAdd={(text) => actions.add(p.id, m.id, text, 'todo')} />
                      </AccordionTab>
                    ))}
                  </Accordion>
                )}
              </div>
            </div>
          )}
        </TabPanel>
        <TabPanel header="Board" leftIcon="pi pi-th-large mr-2">
          {p.milestonesTotal
            ? <TaskBoard projects={[p]} onProjectChanged={setProject} onConflict={reload} />
            : <p className="text-500 m-0">No milestones yet, so there is nothing to put on the board.</p>}
        </TabPanel>
        <TabPanel header="Git" leftIcon="pi pi-github mr-2"><GitInsights projectIds={[p.id]} single /></TabPanel>
        <TabPanel header="Claude" leftIcon="pi pi-sparkles mr-2"><ClaudeInsights projectIds={[p.id]} single /></TabPanel>
        <TabPanel header="Files" leftIcon="pi pi-file mr-2">
          <div className="flex flex-column gap-2">
            <div><span className="text-500">Plan files with milestones: </span>{p.planFiles.length ? p.planFiles.join(', ') : '—'}</div>
            <div><span className="text-500">Detected by: </span>{p.markers.join(', ') || '—'}</div>
            <div><span className="text-500">Included folders: </span>{p.subpaths.length}</div>
          </div>
        </TabPanel>
      </TabView>
    </div>
  );
}
