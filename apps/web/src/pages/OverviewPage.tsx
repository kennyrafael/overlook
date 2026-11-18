import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Chart } from 'primereact/chart';
import { Message } from 'primereact/message';
import { Skeleton } from 'primereact/skeleton';
import { PROJECT_STATUSES, type Project, type ProjectSource } from '@overlook/shared';
import FilterBar from '../components/FilterBar';
import ProgressChart from '../insights/ProgressChart';
import { useInsightScope } from '../insights/useInsightScope';
import { ACTIVITY_BUCKETS, activityBucket, filterProjects, useFilters } from '../store/filters';
import { useProjects } from '../store/projects';
import { baseOptions, chartTokens, selectColor } from '../chartTheme';
import { sourceLabel } from '../format';
import { useTheme } from '../theme/ThemeContext';

const SOURCES: ProjectSource[] = ['root', 'claude', 'both'];
type ClickEvent = { native?: MouseEvent | null };
type ChartEl = { index: number };

function Kpi({ label, value, icon, sub }: { label: string; value: string | number; icon: string; sub?: string }) {
  return (
    <Card className="h-full">
      <div className="flex justify-content-between align-items-start gap-2">
        <div>
          <div className="text-500 mb-2 text-sm">{label}</div>
          <div className="text-3xl font-bold">{value}</div>
          {sub && <small className="text-500">{sub}</small>}
        </div>
        <i className={`${icon} text-2xl text-primary`} />
      </div>
    </Card>
  );
}

function ChartCard({ title, subTitle, height, empty, children }: {
  title: string; subTitle?: string; height: number; empty?: string | false; children: React.ReactNode;
}) {
  return (
    <Card title={title} subTitle={subTitle} className="h-full">
      {empty ? <p className="text-500 m-0">{empty}</p> : <div style={{ height }}>{children}</div>}
    </Card>
  );
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const { version: themeVersion } = useTheme();
  const { projects, loaded, error } = useProjects();
  const filters = useFilters();
  const scope = useInsightScope();

  const visible = useMemo(() => filterProjects(projects, filters), [projects, filters]);

  const kpi = useMemo(() => {
    const planned = visible.filter((p) => p.milestonesTotal > 0);
    return {
      count: visible.length,
      planned: planned.length,
      active: visible.filter((p) => p.status === 'active').length,
      avg: planned.length ? Math.round(planned.reduce((s, p) => s + p.progress, 0) / planned.length) : 0,
      milestonesLeft: visible.reduce((s, p) => s + p.milestonesTotal - p.milestonesReached, 0),
      milestonesTotal: visible.reduce((s, p) => s + p.milestonesTotal, 0),
      tasksLeft: visible.reduce((s, p) => s + p.tasksTotal - p.tasksDone, 0),
      tasksTotal: visible.reduce((s, p) => s + p.tasksTotal, 0),
      sessions: visible.reduce((s, p) => s + p.claudeSessions, 0),
      stale: visible.filter((p) => p.status === 'paused').length,
    };
  }, [visible]);

  const charts = useMemo(() => {
    const t = chartTokens();
    const base = baseOptions(t);
    const pointer = { onHover: (e: { native?: { target?: HTMLElement } }, els: ChartEl[]) => {
      const el = e.native?.target;
      if (el) el.style.cursor = els.length ? 'pointer' : 'default';
    } };
    const bar = { borderRadius: 4, borderSkipped: false, barThickness: 14 };

    // Status doughnut: filtered by everything except status.
    const byStatusBase = filterProjects(projects, filters, 'statuses');
    const statusCounts = PROJECT_STATUSES.map((s) => byStatusBase.filter((p) => p.status === s).length);
    const status = {
      data: {
        labels: PROJECT_STATUSES,
        datasets: [{
          data: statusCounts,
          backgroundColor: PROJECT_STATUSES.map((s) => selectColor(t.status[s], filters.statuses.includes(s), filters.statuses.length > 0)),
          borderColor: t.surface, borderWidth: 2, hoverOffset: 6,
        }],
      },
      options: {
        ...pointer,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: { legend: { position: 'bottom', labels: { ...base.plugins.legend.labels } } },
        onClick: (_: ClickEvent, els: ChartEl[]) => { if (els.length) filters.toggle('statuses', PROJECT_STATUSES[els[0].index]); },
      },
    };

    // Last activity buckets.
    const byActivityBase = filterProjects(projects, filters, 'activity');
    const activity = {
      data: {
        labels: ACTIVITY_BUCKETS.map((b) => b.label),
        datasets: [{
          label: 'Projects',
          data: ACTIVITY_BUCKETS.map((b) => byActivityBase.filter((p) => activityBucket(p) === b.value).length),
          backgroundColor: ACTIVITY_BUCKETS.map((b) => selectColor(t.primary, filters.activity.includes(b.value), filters.activity.length > 0)),
          ...bar, barThickness: 22,
        }],
      },
      options: {
        ...base, ...pointer,
        plugins: { legend: { display: false } },
        scales: {
          x: { ...base.scales.x, grid: { display: false } },
          y: { ...base.scales.y, grid: { color: t.grid }, ticks: { ...base.scales.y.ticks, precision: 0 } },
        },
        onClick: (_: ClickEvent, els: ChartEl[]) => { if (els.length) filters.toggle('activity', ACTIVITY_BUCKETS[els[0].index].value); },
      },
    };

    // Source breakdown.
    const bySourceBase = filterProjects(projects, filters, 'sources');
    const sources = {
      data: {
        labels: SOURCES.map((s) => sourceLabel[s]),
        datasets: [{
          label: 'Projects',
          data: SOURCES.map((s) => bySourceBase.filter((p) => p.source === s).length),
          backgroundColor: SOURCES.map((s) => selectColor(t.primary, filters.sources.includes(s), filters.sources.length > 0)),
          ...bar,
        }],
      },
      options: {
        ...base, ...pointer, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, precision: 0 } } },
        onClick: (_: ClickEvent, els: ChartEl[]) => { if (els.length) filters.toggle('sources', SOURCES[els[0].index]); },
      },
    };

    // Per-project charts: filtered by everything except the project selection.
    const byProjectBase = filterProjects(projects, filters, 'projectIds');
    const projectClick = (list: Project[]) => (e: ClickEvent, els: ChartEl[]) => {
      if (!els.length) return;
      const p = list[els[0].index];
      if (e.native?.ctrlKey || e.native?.metaKey) navigate(`/projects/${p.id}`);
      else filters.toggle('projectIds', p.id);
    };
    const anyProject = filters.projectIds.length > 0;

    const planned = byProjectBase.filter((p) => p.milestonesTotal > 0).sort((a, b) => b.progress - a.progress || a.name.localeCompare(b.name));
    const progress = {
      list: planned,
      data: {
        labels: planned.map((p) => p.name),
        datasets: [
          {
            label: 'Milestones reached',
            data: planned.map((p) => p.progress),
            backgroundColor: planned.map((p) => selectColor(t.primary, filters.projectIds.includes(p.id), anyProject)),
            ...bar,
          },
        ],
      },
      options: {
        ...base, ...pointer, indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c: { dataIndex: number }) => {
            const p = planned[c.dataIndex];
            return `${p.progress}% · ${p.milestonesReached}/${p.milestonesTotal} milestones · ${p.tasksDone}/${p.tasksTotal} tasks`;
          } } },
        },
        scales: { ...base.scales, x: { ...base.scales.x, min: 0, max: 100, ticks: { ...base.scales.x.ticks, callback: (v: number) => `${v}%` } } },
        onClick: projectClick(planned),
      },
      height: Math.max(120, planned.length * 30 + 40),
    };

    const bySessions = byProjectBase.filter((p) => p.claudeSessions > 0).sort((a, b) => b.claudeSessions - a.claudeSessions).slice(0, 12);
    const sessions = {
      list: bySessions,
      data: {
        labels: bySessions.map((p) => p.name),
        datasets: [{
          label: 'Claude sessions',
          data: bySessions.map((p) => p.claudeSessions),
          backgroundColor: bySessions.map((p) => selectColor(t.primary, filters.projectIds.includes(p.id), anyProject)),
          ...bar,
        }],
      },
      options: {
        ...base, ...pointer, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, precision: 0 } } },
        onClick: projectClick(bySessions),
      },
      height: Math.max(120, bySessions.length * 30 + 40),
    };

    // Milestones: reached vs open, per project (stacked).
    const withMs = planned;
    const milestones = {
      data: {
        labels: withMs.map((p) => p.name),
        datasets: [
          { label: 'Reached', data: withMs.map((p) => p.milestonesReached), backgroundColor: t.done, borderColor: t.surface, borderWidth: { right: 2 }, ...bar },
          { label: 'Open', data: withMs.map((p) => p.milestonesTotal - p.milestonesReached), backgroundColor: t.todo, borderColor: t.surface, borderWidth: { right: 2 }, ...bar },
        ],
      },
      options: {
        ...base, ...pointer, indexAxis: 'y',
        plugins: { ...base.plugins, legend: { ...base.plugins.legend, position: 'top', align: 'start' } },
        scales: {
          x: { ...base.scales.x, stacked: true, ticks: { ...base.scales.x.ticks, precision: 0 } },
          y: { ...base.scales.y, stacked: true },
        },
        onClick: projectClick(withMs),
      },
      height: Math.max(120, withMs.length * 30 + 70),
    };

    // Tags.
    const byTagBase = filterProjects(projects, filters, 'tags');
    const tagNames = [...new Set(projects.flatMap((p) => p.tags))].sort();
    const tags = {
      data: {
        labels: tagNames,
        datasets: [{
          label: 'Projects',
          data: tagNames.map((tag) => byTagBase.filter((p) => p.tags.includes(tag)).length),
          backgroundColor: tagNames.map((tag) => selectColor(t.primary, filters.tags.includes(tag), filters.tags.length > 0)),
          ...bar,
        }],
      },
      options: {
        ...base, ...pointer, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, precision: 0 } } },
        onClick: (_: ClickEvent, els: ChartEl[]) => { if (els.length) filters.toggle('tags', tagNames[els[0].index]); },
      },
      height: Math.max(100, tagNames.length * 30 + 40),
    };

    return { status, activity, sources, progress, sessions, milestones, tags, statusTotal: statusCounts.reduce((a, b) => a + b, 0) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, filters, themeVersion, navigate]);

  if (error) return <Message severity="error" text={`Could not load projects: ${error}`} />;
  if (!loaded) return <Skeleton height="20rem" />;
  if (!projects.length) {
    return <Message severity="info" text="No projects yet. Add a root folder in Settings, then save to scan." />;
  }

  const hint = 'Click to filter · Ctrl+click to open';
  return (
    <div className="flex flex-column gap-3">
      <FilterBar />
      <div className="grid">
        <div className="col-6 md:col-4 xl:col-2"><Kpi label="Projects" value={kpi.count} icon="pi pi-folder" sub={`${kpi.planned} with a plan`} /></div>
        <div className="col-6 md:col-4 xl:col-2"><Kpi label="Active" value={kpi.active} icon="pi pi-bolt" sub={`${kpi.stale} paused`} /></div>
        <div className="col-6 md:col-4 xl:col-2"><Kpi label="Avg progress" value={`${kpi.avg}%`} icon="pi pi-percentage" sub="projects with a plan" /></div>
        <div className="col-6 md:col-4 xl:col-2"><Kpi label="Milestones left" value={kpi.milestonesLeft} icon="pi pi-flag" sub={`of ${kpi.milestonesTotal}`} /></div>
        <div className="col-6 md:col-4 xl:col-2"><Kpi label="Open tasks" value={kpi.tasksLeft} icon="pi pi-list-check" sub={`of ${kpi.tasksTotal}`} /></div>
        <div className="col-6 md:col-4 xl:col-2"><Kpi label="Claude sessions" value={kpi.sessions} icon="pi pi-sparkles" sub="all time" /></div>

        <div className="col-12 md:col-6 xl:col-4">
          <ChartCard title="Status" subTitle="Click a slice to filter" height={260} empty={!charts.statusTotal && 'No projects match.'}>
            <Chart type="doughnut" data={charts.status.data} options={charts.status.options} style={{ height: '100%' }} />
          </ChartCard>
        </div>
        <div className="col-12 md:col-6 xl:col-4">
          <ChartCard title="Last activity" subTitle="Click a bar to filter" height={260}>
            <Chart type="bar" data={charts.activity.data} options={charts.activity.options} style={{ height: '100%' }} />
          </ChartCard>
        </div>
        <div className="col-12 xl:col-4">
          <ChartCard title="Source" subTitle="Where the project was found" height={160}>
            <Chart type="bar" data={charts.sources.data} options={charts.sources.options} style={{ height: '100%' }} />
          </ChartCard>
        </div>

        <div className="col-12">
          <ProgressChart projectIds={scope.ids} />
        </div>

        <div className="col-12 lg:col-6">
          <ChartCard title="Progress by project" subTitle={`Milestones reached · ${hint}`} height={charts.progress.height}
            empty={!charts.progress.list.length && 'No project with a plan matches. Add checklists under headings in PLAN.md, ROADMAP.md or TODO.md.'}>
            <Chart type="bar" data={charts.progress.data} options={charts.progress.options} style={{ height: '100%' }} />
          </ChartCard>
        </div>
        <div className="col-12 lg:col-6">
          <ChartCard title="Claude sessions" subTitle={`Top 12 projects · ${hint}`} height={charts.sessions.height}
            empty={!charts.sessions.list.length && 'No Claude sessions for the matching projects.'}>
            <Chart type="bar" data={charts.sessions.data} options={charts.sessions.options} style={{ height: '100%' }} />
          </ChartCard>
        </div>

        <div className={charts.tags.data.labels.length ? 'col-12 lg:col-8' : 'col-12'}>
          <ChartCard title="Milestones" subTitle={`Reached vs open · ${hint}`} height={charts.milestones.height}
            empty={!charts.progress.list.length && 'No milestones for the matching projects.'}>
            <Chart type="bar" data={charts.milestones.data} options={charts.milestones.options} style={{ height: '100%' }} />
          </ChartCard>
        </div>
        {charts.tags.data.labels.length > 0 && (
          <div className="col-12 lg:col-4">
            <ChartCard title="Tags" subTitle="Click a bar to filter" height={charts.tags.height}>
              <Chart type="bar" data={charts.tags.data} options={charts.tags.options} style={{ height: '100%' }} />
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  );
}
