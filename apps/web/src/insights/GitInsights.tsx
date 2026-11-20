import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Chart } from 'primereact/chart';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { Button } from 'primereact/button';
import { SelectButton } from 'primereact/selectbutton';
import { Message } from 'primereact/message';
import { Skeleton } from 'primereact/skeleton';
import type { GitOverview, RepoStats } from '@overlook/shared';
import { api } from '../api';
import { baseOptions, chartTokens, selectColor } from '../chartTheme';
import { localDay, relativeTime } from '../format';
import { useFilters } from '../store/filters';
import { useTheme } from '../theme/ThemeContext';
import CommitHeatmap from './CommitHeatmap';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';
import RepoBranchesDetail from './RepoBranches';

interface Props {
  /** Restrict to these projects; undefined = all. */
  projectIds?: string[];
  /** Project tab: hide per-project charts and project links. */
  single?: boolean;
}

type Row = RepoStats & { projectId: string; projectName: string; commits30: number; commits90: number };

function sumSince(perDay: Record<string, number>, days: number): number {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const from = localDay(since);
  return Object.entries(perDay).filter(([d]) => d >= from).reduce((s, [, n]) => s + n, 0);
}

function Kpi({ label, value, sub, icon, tone }: { label: string; value: string | number; sub?: string; icon: string; tone?: string }) {
  return (
    <Card className="h-full">
      <div className="flex justify-content-between align-items-start gap-2">
        <div>
          <div className="text-500 mb-2 text-sm">{label}</div>
          <div className="text-3xl font-bold">{value}</div>
          {sub && <small className="text-500">{sub}</small>}
        </div>
        <i className={`${icon} text-2xl`} style={{ color: tone ?? 'var(--primary-color)' }} />
      </div>
    </Card>
  );
}

export default function GitInsights({ projectIds, single }: Props) {
  const { version: themeVersion } = useTheme();
  const filters = useFilters();
  const [data, setData] = useState<GitOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'all' | 'attention'>('all');
  // Branches and worktrees are read per repository when its row is expanded (keeps the overview light).
  const [expanded, setExpanded] = useState<Row[]>([]);
  const key = projectIds?.join(',') ?? 'all';

  const load = useCallback(async (refresh = false) => {
    setError(null);
    if (refresh) setRefreshing(true);
    try {
      setData(await api.git(projectIds, refresh));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { load(); }, [load]);

  const gitVersion = useLive((s) => s.git);
  useOnChange(gitVersion, () => {
    const touched = useLive.getState().lastGitIds;
    if (!projectIds || !touched.length || touched.some((t) => projectIds.includes(t))) load();
  });

  const rows: Row[] = useMemo(() => (data?.projects ?? []).flatMap((p) => p.repos.map((r) => ({
    ...r, projectId: p.projectId, projectName: p.name,
    commits30: sumSince(r.commitsPerDay, 30), commits90: sumSince(r.commitsPerDay, 90),
  }))), [data]);

  const heat = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rows) for (const [d, n] of Object.entries(r.commitsPerDay)) out[d] = (out[d] ?? 0) + n;
    return out;
  }, [rows]);

  const kpi = useMemo(() => ({
    repos: rows.length,
    dirtyRepos: rows.filter((r) => r.dirtyFiles > 0).length,
    dirtyFiles: rows.reduce((s, r) => s + r.dirtyFiles, 0),
    unpushed: rows.reduce((s, r) => s + r.ahead, 0),
    behind: rows.reduce((s, r) => s + r.behind, 0),
    noUpstream: rows.filter((r) => !r.upstream && r.branch).length,
    commits30: rows.reduce((s, r) => s + r.commits30, 0),
    commits7: rows.reduce((s, r) => s + sumSince(r.commitsPerDay, 7), 0),
  }), [rows]);

  const perProject = useMemo(() => {
    if (single) return null;
    const t = chartTokens();
    const base = baseOptions(t);
    const byProject = (data?.projects ?? []).map((p) => ({
      id: p.projectId, name: p.name,
      commits: p.repos.reduce((s, r) => s + sumSince(r.commitsPerDay, 30), 0),
      dirty: p.repos.reduce((s, r) => s + r.dirtyFiles, 0),
    })).sort((a, b) => b.commits - a.commits);
    const any = filters.projectIds.length > 0;
    return {
      list: byProject,
      height: Math.max(140, byProject.length * 30 + 40),
      data: {
        labels: byProject.map((p) => p.name),
        datasets: [{
          label: 'Commits (30 days)',
          data: byProject.map((p) => p.commits),
          backgroundColor: byProject.map((p) => selectColor(t.primary, filters.projectIds.includes(p.id), any)),
          borderRadius: 4, borderSkipped: false, barThickness: 14,
        }],
      },
      options: {
        ...base, indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { afterLabel: (c: { dataIndex: number }) => `${byProject[c.dataIndex].dirty} uncommitted files` } },
        },
        scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, precision: 0 } } },
        onHover: (e: { native?: { target?: HTMLElement } }, els: unknown[]) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        onClick: (_: unknown, els: { index: number }[]) => { if (els.length) filters.toggle('projectIds', byProject[els[0].index].id); },
      },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, single, filters.projectIds, themeVersion]);

  if (error) return <Message severity="error" text={`Could not read git data: ${error}`} />;
  if (!data) return <Skeleton height="16rem" />;
  if (data.gitAvailable === false) return <GitMissing />;
  if (!rows.length) return <Message severity="info" text="No git repositories found for these projects." />;

  const attention = rows.filter((r) => r.dirtyFiles > 0 || r.ahead > 0 || r.behind > 0 || (!r.upstream && r.branch) || r.error);
  const shown = view === 'attention' ? attention : rows;

  const syncBody = (r: Row) => {
    if (r.error) return <Tag severity="danger" value="error" title={r.error} />;
    if (!r.upstream) return <Tag severity="secondary" value="no upstream" icon="pi pi-cloud" />;
    if (!r.ahead && !r.behind) return <Tag severity="success" value="in sync" icon="pi pi-check" />;
    return (
      <span className="flex gap-1">
        {r.ahead > 0 && <Tag severity="warning" value={`↑ ${r.ahead} to push`} />}
        {r.behind > 0 && <Tag severity="info" value={`↓ ${r.behind} to pull`} />}
      </span>
    );
  };

  return (
    <div className="grid">
      <div className="col-6 md:col-3"><Kpi label="Repositories" value={kpi.repos} icon="pi pi-github" sub={`${kpi.commits7} commits this week`} /></div>
      <div className="col-6 md:col-3"><Kpi label="Uncommitted" value={kpi.dirtyFiles} icon="pi pi-pencil" sub={`in ${kpi.dirtyRepos} repo${kpi.dirtyRepos === 1 ? '' : 's'}`} tone={kpi.dirtyFiles ? 'var(--yellow-500)' : undefined} /></div>
      <div className="col-6 md:col-3"><Kpi label="Unpushed commits" value={kpi.unpushed} icon="pi pi-upload" sub={`${kpi.behind} to pull · ${kpi.noUpstream} without upstream`} tone={kpi.unpushed ? 'var(--yellow-500)' : undefined} /></div>
      <div className="col-6 md:col-3"><Kpi label="Commits (30 days)" value={kpi.commits30} icon="pi pi-history" sub="on checked-out branches" /></div>

      <div className={single ? 'col-12' : 'col-12 xl:col-5'}>
        <Card title="Commit activity" subTitle={`Last ${data.days} days · checked-out branch of each repo`} className="h-full">
          <CommitHeatmap counts={heat} days={data.days} />
        </Card>
      </div>
      {perProject && (
        <div className="col-12 xl:col-7">
          <Card title="Commits by project" subTitle="Last 30 days · click a bar to filter" className="h-full">
            <div style={{ height: perProject.height }}>
              <Chart type="bar" data={perProject.data} options={perProject.options} style={{ height: '100%' }} />
            </div>
          </Card>
        </div>
      )}

      <div className="col-12">
        <Card>
          <div className="flex flex-wrap align-items-center gap-2 mb-3">
            <SelectButton value={view} onChange={(e) => e.value && setView(e.value)}
              options={[{ label: `All (${rows.length})`, value: 'all' }, { label: `Needs attention (${attention.length})`, value: 'attention' }]} />
            <small className="text-500 ml-auto">Updated {relativeTime(data.generatedAt)}</small>
            <Button icon="pi pi-refresh" label="Refresh" outlined size="small" loading={refreshing} onClick={() => load(true)} />
          </div>
          <DataTable value={shown} dataKey="path" size="small" stripedRows removableSort sortField="lastCommitAt" sortOrder={-1}
            emptyMessage="Everything is committed and in sync." paginator={shown.length > 15} rows={15}
            expandedRows={expanded} onRowToggle={(e) => setExpanded(e.data as Row[])}
            rowExpansionTemplate={(r: Row) => <RepoBranchesDetail projectId={r.projectId} repo={r.relPath} />}>
            <Column expander={(r: Row) => !r.error} style={{ width: '3rem' }} header={<span className="sr-only">Branches and worktrees</span>} />
            {!single && (
              <Column field="projectName" header="Project" sortable
                body={(r: Row) => <Link to={`/projects/${r.projectId}`} className="text-color no-underline hover:text-primary font-semibold">{r.projectName}</Link>} />
            )}
            <Column field="relPath" header="Repository" sortable body={(r: Row) => <code>{r.relPath || '.'}</code>} />
            <Column field="branch" header="Branch" sortable body={(r: Row) => (
              <span className="flex align-items-center gap-1"><i className="pi pi-sitemap text-500 text-sm" />{r.branch ?? <em className="text-500">detached</em>}</span>
            )} />
            <Column field="dirtyFiles" header="Uncommitted" sortable body={(r: Row) => (
              r.dirtyFiles ? <Tag severity="warning" value={`${r.dirtyFiles} file${r.dirtyFiles === 1 ? '' : 's'}`} icon="pi pi-pencil" /> : <span className="text-500">clean</span>
            )} />
            <Column header="Sync" body={syncBody} />
            <Column field="commits30" header="30 d" sortable style={{ width: '5rem' }} />
            <Column field="lastCommitAt" header="Last commit" sortable body={(r: Row) => (
              <div className="flex flex-column" style={{ maxWidth: '22rem' }}>
                <span title={r.lastCommitAt ?? ''}>{relativeTime(r.lastCommitAt)}</span>
                {r.lastCommitSubject && <small className="text-500 white-space-nowrap overflow-hidden text-overflow-ellipsis" title={r.lastCommitSubject}>{r.lastCommitSubject}</small>}
              </div>
            )} />
          </DataTable>
        </Card>
      </div>
    </div>
  );
}

function GitMissing() {
  return (
    <Message severity="info" data-testid="git-missing" className="w-full justify-content-start" content={
      <div className="flex flex-column gap-1">
        <strong>Git is not installed</strong>
        <span>Git statistics need git on your PATH. Projects, plans and Claude usage work without it.</span>
        <span>
          Install it from <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">git-scm.com/downloads</a>
          {' '}(on Windows: <code>winget install Git.Git</code>), then reopen this page.
        </span>
      </div>
    } />
  );
}
