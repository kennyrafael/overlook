import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Chart } from 'primereact/chart';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { SelectButton } from 'primereact/selectbutton';
import { Calendar } from 'primereact/calendar';
import { InputText } from 'primereact/inputtext';
import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { Message } from 'primereact/message';
import { Skeleton } from 'primereact/skeleton';
import type { ClaudeOverview, ClaudeSession } from '@overlook/shared';
import { api } from '../api';
import { baseOptions, chartTokens, selectColor } from '../chartTheme';
import { formatCompact, formatDuration, formatUsd, localDay, relativeTime } from '../format';
import { useFilters } from '../store/filters';
import { useTheme } from '../theme/ThemeContext';
import { MAX_MODEL_SERIES, categorical, modelLabel, modelSlot } from './palette';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';
import { Button } from 'primereact/button';
import { resumeSession, useClaudeAvailable } from '../actions/projectActions';
import PromptSearch from './PromptSearch';
import { ToolTable } from './SessionDetail';

type Preset = '7' | '30' | '90' | 'all' | 'custom';

interface Props {
  projectIds?: string[];
  single?: boolean;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return localDay(d);
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end && out.length < 1000) { out.push(localDay(d)); d.setDate(d.getDate() + 1); }
  return out;
}

function Kpi({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon: string }) {
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

export default function ClaudeInsights({ projectIds, single }: Props) {
  const { mode, version: themeVersion } = useTheme();
  const filters = useFilters();
  const claudeOk = useClaudeAvailable();
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState<(Date | null)[] | null>(null);
  const [data, setData] = useState<ClaudeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const key = projectIds?.join(',') ?? 'all';

  const claudeVersion = useLive((s) => s.claude);
  useOnChange(claudeVersion, () => {
    const touched = useLive.getState().lastClaudeIds;
    if (!projectIds || !touched.length || touched.some((t) => projectIds.includes(t))) setReloadTick((n) => n + 1);
  });

  const range = useMemo(() => {
    if (preset === 'all') return {};
    if (preset === 'custom' && custom?.[0]) {
      return { from: localDay(custom[0]), to: localDay(custom[1] ?? custom[0]) };
    }
    const n = preset === 'custom' ? 30 : Number(preset);
    return { from: daysAgo(n), to: localDay(new Date()) };
  }, [preset, custom]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.claude(range, projectIds)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, key, reloadTick]);

  const charts = useMemo(() => {
    if (!data) return null;
    const t = chartTokens();
    const base = baseOptions(t);
    const hover = { onHover: (e: { native?: { target?: HTMLElement } }, els: unknown[]) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } };

    // Daily cost stacked by model (fixed colour per model, "Other" folds the rest).
    const firstDay = data.from ?? data.days[0]?.date ?? localDay(new Date());
    const lastDay = data.to ?? localDay(new Date());
    const days = eachDay(firstDay, lastDay);
    const byDay = new Map(data.days.map((d) => [d.date, d]));
    const slots = new Map<number, string[]>();
    for (const m of data.byModel) {
      const s = modelSlot(m.model);
      slots.set(s, [...(slots.get(s) ?? []), m.model]);
    }
    const series = [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([slot, models]) => ({
      label: slot === MAX_MODEL_SERIES ? 'Other' : modelLabel(models[0]),
      backgroundColor: categorical(slot, mode),
      borderColor: t.surface,
      borderWidth: { top: 2 },
      borderSkipped: 'bottom',
      borderRadius: 2,
      maxBarThickness: 22,
      data: days.map((d) => models.reduce((s, m) => s + (byDay.get(d)?.costByModel[m] ?? 0), 0)),
    }));
    const daily = {
      data: { labels: days.map((d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })), datasets: series },
      options: {
        ...base,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          ...base.plugins,
          legend: { ...base.plugins.legend, position: 'top', align: 'start' },
          tooltip: {
            mode: 'index', intersect: false,
            filter: (i: { raw: number }) => i.raw > 0,
            callbacks: {
              label: (c: { dataset: { label: string }; raw: number }) => ` ${c.dataset.label}: ${formatUsd(c.raw)}`,
              footer: (items: { dataIndex: number }[]) => {
                const d = byDay.get(days[items[0]?.dataIndex]);
                return d ? `Total ${formatUsd(d.costUsd)} · ${d.sessions} session${d.sessions === 1 ? '' : 's'} · ${formatCompact(d.tokens.output)} output tokens` : '';
              },
            },
          },
        },
        scales: {
          x: { ...base.scales.x, stacked: true, grid: { display: false }, ticks: { ...base.scales.x.ticks, maxRotation: 0, autoSkipPadding: 12 } },
          y: { ...base.scales.y, stacked: true, grid: { color: t.grid }, ticks: { ...base.scales.y.ticks, callback: (v: number) => formatUsd(v) } },
        },
      },
    };

    // Cost by project (click toggles the global project filter).
    const projects = data.byProject.filter((p) => p.costUsd > 0 || p.sessions > 0).slice(0, 15);
    const any = filters.projectIds.length > 0;
    const byProject = {
      height: Math.max(140, projects.length * 30 + 40),
      data: {
        labels: projects.map((p) => p.name),
        datasets: [{
          label: 'Estimated cost',
          data: projects.map((p) => p.costUsd),
          backgroundColor: projects.map((p) => (p.projectId ? selectColor(t.primary, filters.projectIds.includes(p.projectId), any) : t.todo)),
          borderRadius: 4, borderSkipped: false, barThickness: 14,
        }],
      },
      options: {
        ...base, ...hover, indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: (c: { raw: number }) => ` ${formatUsd(c.raw)}`,
            afterLabel: (c: { dataIndex: number }) => {
              const p = projects[c.dataIndex];
              return `${p.sessions} sessions · ${formatCompact(p.tokens.output)} output tokens`;
            },
          } },
        },
        scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, callback: (v: number) => formatUsd(v) } } },
        onClick: (_: unknown, els: { index: number }[]) => {
          const p = els.length ? projects[els[0].index] : null;
          if (p?.projectId) filters.toggle('projectIds', p.projectId);
        },
      },
    };
    return { daily, byProject, hasCost: data.days.some((d) => d.costUsd > 0) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, themeVersion, filters.projectIds]);

  const sessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.sessions ?? []).filter((s) => !q
      || (s.title ?? '').toLowerCase().includes(q) || s.projectName.toLowerCase().includes(q) || s.models.some((m) => m.includes(q)));
  }, [data, search]);

  const rangeControl = (
    <div className="flex flex-wrap align-items-center gap-2">
      <SelectButton value={preset} onChange={(e) => e.value && setPreset(e.value)}
        options={[{ label: '7 days', value: '7' }, { label: '30 days', value: '30' }, { label: '90 days', value: '90' }, { label: 'All', value: 'all' }]} />
      <Calendar value={custom as Date[] | null} onChange={(e) => { setCustom(e.value as (Date | null)[]); setPreset('custom'); }}
        selectionMode="range" readOnlyInput showIcon placeholder="Custom range" maxDate={new Date()} dateFormat="d M yy"
        className={preset === 'custom' ? 'p-inputwrapper-filled' : ''} style={{ width: '16rem' }} />
    </div>
  );

  if (error) return <div className="flex flex-column gap-3">{rangeControl}<Message severity="error" text={`Could not read Claude logs: ${error}`} /></div>;
  if (!data || !charts) return <div className="flex flex-column gap-3">{rangeControl}<Skeleton height="16rem" /></div>;

  const t = data.totals;
  return (
    <div className="flex flex-column gap-3">
      <div className="flex flex-wrap align-items-center gap-2">
        {rangeControl}
        <small className="text-500 ml-auto"><i className="pi pi-info-circle mr-1" />Costs are estimates at API list prices (editable in Settings), not your subscription bill.</small>
      </div>
      {data.logFormat?.unrecognizedFiles > 0 && (
        <Message severity="warn" data-testid="log-format-warning"
          text={`Unrecognized log format in ${data.logFormat.unrecognizedFiles} of ${data.logFormat.files} Claude Code session logs; they are skipped, so totals may be low. A newer Claude Code may have changed its format. Check for an Overlook update.`} />
      )}
      {!t.sessions ?<Message severity="info" text="No Claude Code sessions in this period." /> : (
        <div className="grid">
          <div className="col-6 md:col-4 xl:col-2"><Kpi label="Sessions" value={t.sessions} icon="pi pi-comments" sub={`${t.prompts} prompts`} /></div>
          <div className="col-6 md:col-4 xl:col-2"><Kpi label="Model turns" value={formatCompact(t.turns)} icon="pi pi-sync" sub={`${(t.turns / Math.max(1, t.prompts)).toFixed(1)} per prompt`} /></div>
          <div className="col-6 md:col-4 xl:col-2"><Kpi label="Output tokens" value={formatCompact(t.tokens.output)} icon="pi pi-pencil" sub={`${formatCompact(t.tokens.input)} uncached input`} /></div>
          <div className="col-6 md:col-4 xl:col-2"><Kpi label="Cache reads" value={formatCompact(t.tokens.cacheRead)} icon="pi pi-database" sub={`${formatCompact(t.tokens.cacheWrite)} written`} /></div>
          <div className="col-6 md:col-4 xl:col-2"><Kpi label="Est. cost" value={formatUsd(t.costUsd)} icon="pi pi-dollar" sub={t.unpricedTurns ? `${t.unpricedTurns} turns unpriced` : 'at list prices'} /></div>
          <div className="col-6 md:col-4 xl:col-2"><Kpi label="Per session" value={formatUsd(t.costUsd / t.sessions)} icon="pi pi-chart-line" sub="average est. cost" /></div>

          <div className={single ? 'col-12' : 'col-12 xl:col-7'}>
            <Card title="Estimated cost per day" subTitle="Stacked by model · hover for totals" className="h-full">
              <div style={{ height: 300 }}>
                <Chart type="bar" data={charts.daily.data} options={charts.daily.options} style={{ height: '100%' }} />
              </div>
            </Card>
          </div>
          {!single && (
            <div className="col-12 xl:col-5">
              <Card title="Cost by project" subTitle="Click a bar to filter" className="h-full">
                <div style={{ height: charts.byProject.height }}>
                  <Chart type="bar" data={charts.byProject.data} options={charts.byProject.options} style={{ height: '100%' }} />
                </div>
              </Card>
            </div>
          )}

          <div className="col-12 lg:col-5">
            <Card title="Models" className="h-full">
              <DataTable value={data.byModel} dataKey="model" size="small" sortField="costUsd" sortOrder={-1} removableSort>
                <Column field="model" header="Model" sortable body={(m: ClaudeOverview['byModel'][number]) => (
                  <span className="flex align-items-center gap-2">
                    <span className="heat-legend" style={{ background: categorical(modelSlot(m.model), mode) }} />
                    <span title={m.model}>{modelLabel(m.model)}</span>
                    {!m.priced && <Tag severity="warning" value="no price" />}
                  </span>
                )} />
                <Column field="turns" header="Turns" sortable body={(m) => formatCompact(m.turns)} />
                <Column field="tokens.output" header="Output" sortable body={(m) => formatCompact(m.tokens.output)} />
                <Column field="tokens.cacheRead" header="Cache read" sortable body={(m) => formatCompact(m.tokens.cacheRead)} />
                <Column field="costUsd" header="Est. cost" sortable body={(m) => (
                  <span>{formatUsd(m.costUsd)} <small className="text-500">{t.costUsd ? Math.round((m.costUsd / t.costUsd) * 100) : 0}%</small></span>
                )} />
              </DataTable>
            </Card>
          </div>

          <div className="col-12 lg:col-7">
            <Card title="Sessions" className="h-full">
              <IconField iconPosition="left" className="mb-2">
                <InputIcon className="pi pi-search" />
                <InputText className="w-full" placeholder="Search title, project or model…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </IconField>
              <DataTable value={sessions} dataKey="id" size="small" paginator rows={8} sortField="endedAt" sortOrder={-1} removableSort
                emptyMessage="No sessions match.">
                <Column field="title" header="Session" sortable body={(s: ClaudeSession) => (
                  <div className="flex flex-column" style={{ maxWidth: '20rem' }}>
                    <Link to={`/claude/sessions/${s.id}`} className="white-space-nowrap overflow-hidden text-overflow-ellipsis no-underline text-color hover:text-primary"
                      title={`Open session details: ${s.title ?? s.id}`}>{s.title ?? <em className="text-500">untitled</em>}</Link>
                    {s.task && (
                      <small className="text-500 white-space-nowrap overflow-hidden text-overflow-ellipsis" title={`Likely plan task: ${s.task.text}`}>
                        <i className="pi pi-check-square text-xs mr-1" />{s.task.text}
                      </small>
                    )}
                    {!single && (s.projectId
                      ? <Link to={`/projects/${s.projectId}`} className="text-500 text-sm no-underline hover:text-primary">{s.projectName}</Link>
                      : <small className="text-500">{s.projectName}</small>)}
                  </div>
                )} />
                <Column field="endedAt" header="When" sortable body={(s: ClaudeSession) => (
                  <div className="flex flex-column">
                    <span title={s.startedAt}>{relativeTime(s.endedAt)}</span>
                    <small className="text-500">{formatDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt))}</small>
                  </div>
                )} />
                <Column field="prompts" header="Prompts" sortable />
                <Column field="models" header="Models" body={(s: ClaudeSession) => (
                  <div className="flex flex-wrap gap-1">
                    {s.models.map((m) => <span key={m} className="flex align-items-center gap-1 text-sm"><span className="heat-legend" style={{ background: categorical(modelSlot(m), mode) }} />{modelLabel(m)}</span>)}
                    {s.subagents > 0 && <Tag value={`${s.subagents} subagent${s.subagents === 1 ? '' : 's'}`} severity="secondary" />}
                  </div>
                )} />
                <Column field="costUsd" header="Est. cost" sortable body={(s: ClaudeSession) => formatUsd(s.costUsd)} />
                {claudeOk && (
                  <Column header={<span className="sr-only">Resume</span>} body={(s: ClaudeSession) => (s.projectId && s.resumable ? (
                    <Button icon="pi pi-replay" rounded text size="small" aria-label={`Resume ${s.title ?? 'session'}`}
                      title="Resume in a terminal (claude --resume)" onClick={() => { void resumeSession(s.projectId!, s.id, s.title); }} />
                  ) : null)} />
                )}
              </DataTable>
            </Card>
          </div>

          <div className={single ? 'col-12' : 'col-12 lg:col-5'}>
            <ToolsCard data={data} filtered={!!projectIds?.length && !single} />
          </div>
          {!single && (
            <div className="col-12 lg:col-7">
              <RollingCard windows={data.rolling} mode={mode} />
            </div>
          )}
        </div>
      )}
      <PromptSearch projectIds={projectIds} single={single} />
    </div>
  );
}

/** Most-used tools and how often their results came back as errors, in the range. */
function ToolsCard({ data, filtered }: { data: ClaudeOverview; filtered: boolean }) {
  const calls = data.byTool.reduce((n, t) => n + t.calls, 0);
  const errors = data.byTool.reduce((n, t) => n + t.errors, 0);
  const rate = (e: number, c: number) => (c ? `${((e / c) * 100).toFixed(1)}%` : '—');
  const all = data.toolsOverall;
  return (
    <Card title="Tools" className="h-full"
      subTitle={`${formatCompact(calls)} calls · ${rate(errors, calls)} errors${filtered ? ` (all projects: ${rate(all.errors, all.calls)} of ${formatCompact(all.calls)})` : ''} · incl. subagents`}>
      <ToolTable tools={data.byTool} rows={8} />
    </Card>
  );
}

/** Tokens and estimated cost in the last 5 hours and 7 days, all projects, per model. */
function RollingCard({ windows, mode }: { windows: ClaudeOverview['rolling']; mode: 'light' | 'dark' }) {
  return (
    <Card title="Recent usage" subTitle="All projects, to the hour · estimate from local logs, not your plan's limit" className="h-full" data-testid="rolling-usage">
      <div className="grid">
        {windows.map((w) => (
          <div key={w.key} className="col-12 md:col-6">
            <div className="text-500 text-sm mb-1">{w.key === '5h' ? 'Last 5 hours' : 'Last 7 days'}</div>
            <div className="text-3xl font-bold">{formatUsd(w.costUsd)}</div>
            <small className="text-500">
              {formatCompact(w.tokens.output)} output · {formatCompact(w.tokens.input + w.tokens.cacheWrite + w.tokens.cacheRead)} input incl. cache · {formatCompact(w.turns)} turns
              {w.unpricedTurns ? ` · ${w.unpricedTurns} unpriced` : ''}
            </small>
            <ul className="list-none m-0 p-0 mt-2 flex flex-column gap-1">
              {w.byModel.map((m) => (
                <li key={m.model} className="flex align-items-center gap-2 text-sm">
                  <span className="heat-legend" style={{ background: categorical(modelSlot(m.model), mode) }} />
                  <span title={m.model}>{modelLabel(m.model)}</span>
                  <span className="ml-auto">{formatUsd(m.costUsd)}</span>
                  <small className="text-500" style={{ minWidth: '4.5rem', textAlign: 'right' }}>{formatCompact(m.tokens.output)} out</small>
                </li>
              ))}
              {!w.byModel.length && <li className="text-500 text-sm">No Claude use.</li>}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
