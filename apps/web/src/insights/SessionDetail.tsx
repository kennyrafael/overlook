import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Chart } from 'primereact/chart';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { Skeleton } from 'primereact/skeleton';
import { Tag } from 'primereact/tag';
import type { ClaudeSessionDetail, ClaudeToolCount } from '@overlook/shared';
import { api } from '../api';
import { baseOptions, chartTokens } from '../chartTheme';
import { formatCompact, formatDuration, formatUsd } from '../format';
import { useTheme } from '../theme/ThemeContext';
import { categorical, modelLabel, modelSlot } from './palette';
import { resumeSession, useClaudeAvailable } from '../actions/projectActions';

/** At most this many prompts are drawn at first; the rest open on request (long sessions stay quick to show). */
const PROMPTS_SHOWN = 100;

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

export function ToolTable({ tools, rows = 10 }: { tools: ClaudeToolCount[]; rows?: number }) {
  return (
    <DataTable value={tools} dataKey="tool" size="small" paginator={tools.length > rows} rows={rows} emptyMessage="No tool calls.">
      <Column field="tool" header="Tool" body={(t: ClaudeToolCount) => <span className="white-space-nowrap" title={t.tool}>{t.tool}</span>} />
      <Column field="calls" header="Calls" body={(t: ClaudeToolCount) => formatCompact(t.calls)} />
      <Column field="errors" header="Errors" body={(t: ClaudeToolCount) => (
        <span>{t.errors} <small className="text-500">{pct(t.errors, t.calls)}</small></span>
      )} />
    </DataTable>
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

/** /claude/sessions/:id — one Claude Code session, read from its log when opened. */
export default function SessionDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { mode, version: themeVersion } = useTheme();
  const claudeOk = useClaudeAvailable();
  const [data, setData] = useState<ClaudeSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allPrompts, setAllPrompts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api.claudeSession(id)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [id]);

  const chart = useMemo(() => {
    if (!data?.perPrompt.length) return null;
    const t = chartTokens();
    const base = baseOptions(t);
    const rows = data.perPrompt;
    const promptText = (i: number) => (i < 0 ? 'Before the first prompt' : data.prompts[i]?.text ?? `Prompt ${i + 1}`);
    return {
      data: {
        labels: rows.map((r) => (r.prompt < 0 ? '—' : `#${r.prompt + 1}`)),
        datasets: [
          { type: 'bar', label: 'Est. cost', data: rows.map((r) => r.costUsd), backgroundColor: categorical(0, mode), borderRadius: 2, maxBarThickness: 22, yAxisID: 'y' },
          { type: 'line', label: 'Output tokens', data: rows.map((r) => r.tokens.output), borderColor: categorical(1, mode), backgroundColor: categorical(1, mode), pointRadius: rows.length > 60 ? 0 : 2, tension: 0.2, yAxisID: 'y1' },
        ],
      },
      options: {
        ...base,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          ...base.plugins,
          legend: { ...base.plugins.legend, position: 'top', align: 'start' },
          tooltip: {
            mode: 'index', intersect: false,
            callbacks: {
              title: (items: { dataIndex: number }[]) => {
                const p = promptText(rows[items[0]?.dataIndex]?.prompt ?? -1);
                return p.length > 80 ? p.slice(0, 79) + '…' : p;
              },
              label: (c: { datasetIndex: number; raw: number }) => (c.datasetIndex === 0 ? ` Est. cost: ${formatUsd(c.raw)}` : ` Output: ${formatCompact(c.raw)} tokens`),
              footer: (items: { dataIndex: number }[]) => {
                const r = rows[items[0]?.dataIndex];
                return r ? `${r.turns} model turn${r.turns === 1 ? '' : 's'} · ${formatCompact(r.tokens.cacheRead)} cache read` : '';
              },
            },
          },
        },
        scales: {
          x: { ...base.scales.x, grid: { display: false }, ticks: { ...base.scales.x.ticks, maxRotation: 0, autoSkipPadding: 8 } },
          y: { ...base.scales.y, position: 'left', grid: { color: t.grid }, ticks: { ...base.scales.y.ticks, callback: (v: number) => formatUsd(v) } },
          y1: { ...base.scales.y, position: 'right', grid: { display: false }, ticks: { ...base.scales.y.ticks, callback: (v: number) => formatCompact(v) } },
        },
      },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, themeVersion]);

  const back = <Button label="Back" icon="pi pi-arrow-left" text className="align-self-start p-0" onClick={() => navigate(-1)} />;
  if (error) return <div className="flex flex-column gap-3">{back}<Message severity="error" text={`Could not read this session: ${error}`} /></div>;
  if (!data) return <div className="flex flex-column gap-3">{back}<Skeleton height="10rem" /><Skeleton height="18rem" /></div>;

  const t = data.totals;
  const prompts = allPrompts ? data.prompts : data.prompts.slice(0, PROMPTS_SHOWN);
  return (
    <div className="flex flex-column gap-3" data-testid="session-detail">
      {back}
      <Card>
        <div className="flex flex-wrap align-items-start gap-4">
          <div className="flex-grow-1 min-w-0">
            <h2 className="m-0 mb-1">{data.title ?? <em className="text-500">Untitled session</em>}</h2>
            <div className="flex flex-wrap align-items-center gap-2 text-500 text-sm">
              {data.projectId ? <Link to={`/projects/${data.projectId}`} className="no-underline text-primary">{data.projectName}</Link> : <span>{data.projectName}</span>}
              <span>·</span>
              <span>{time(data.startedAt)} – {time(data.endedAt)}</span>
              {data.task && <span title="The plan task this session most likely worked on (a guess)"><i className="pi pi-check-square text-xs mr-1" />{data.task.text}</span>}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {data.models.map((m) => (
                <span key={m} className="flex align-items-center gap-1 text-sm mr-2"><span className="heat-legend" style={{ background: categorical(modelSlot(m), mode) }} />{modelLabel(m)}</span>
              ))}
              {data.subagents > 0 && <Tag value={`${data.subagents} subagent${data.subagents === 1 ? '' : 's'}`} severity="secondary" />}
            </div>
          </div>
          <div className="flex flex-wrap gap-5">
            <Stat label="Duration" value={formatDuration(data.durationMs)} />
            <Stat label="Prompts" value={t.prompts} sub={`${formatCompact(t.turns)} model turns`} />
            <Stat label="Output tokens" value={formatCompact(t.tokens.output)} sub={`${formatCompact(t.tokens.cacheRead)} cache read`} />
            <Stat label="Est. cost" value={formatUsd(t.costUsd)}
              sub={t.subagentCostUsd ? `${formatUsd(t.subagentCostUsd)} in subagents` : t.unpricedTurns ? `${t.unpricedTurns} turns unpriced` : 'at list prices'} />
          </div>
          {claudeOk && data.projectId && data.resumable && (
            <Button label="Resume" icon="pi pi-replay" outlined title="Resume in a terminal (claude --resume)"
              onClick={() => { void resumeSession(data.projectId!, data.id, data.title); }} />
          )}
        </div>
      </Card>

      <div className="grid">
        <div className="col-12 xl:col-8">
          <Card title="Cost and tokens per prompt" subTitle="Everything Claude did until the next prompt (main session) · estimates at list prices" className="h-full">
            {chart ? (
              <div style={{ height: 260 }}><Chart type="bar" data={chart.data} options={chart.options} style={{ height: '100%' }} /></div>
            ) : <p className="text-500 m-0">No model replies in this session.</p>}
          </Card>
        </div>
        <div className="col-12 xl:col-4">
          <Card title="Tools" subTitle={data.subagents ? 'Incl. subagents · errors are results marked as failed' : 'Errors are results marked as failed'} className="h-full">
            <ToolTable tools={data.tools} />
          </Card>
        </div>
        <div className="col-12 xl:col-4">
          <Card title="Files Claude edited" subTitle="Edit, Write, MultiEdit and NotebookEdit; failed edits left out" className="h-full">
            {data.edited.length === 0 ? <p className="text-500 m-0">No files edited.</p> : (
              <ul className="list-none m-0 p-0 flex flex-column gap-1" style={{ maxHeight: '28rem', overflowY: 'auto' }}>
                {data.edited.map((f) => (
                  <li key={f.path} className="flex gap-2 align-items-baseline">
                    <i className="pi pi-file-edit text-500 text-sm" />
                    <span className="break-all text-sm font-mono">{f.path}</span>
                    <small className="text-500 ml-auto white-space-nowrap">{f.edits}×</small>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="col-12 xl:col-8">
          <Card title="Prompts" subTitle="In order, as typed (long ones cut short)" className="h-full">
            {data.prompts.length === 0 ? <p className="text-500 m-0">No typed prompts.</p> : (
              <ol className="m-0 pl-4 flex flex-column gap-2">
                {prompts.map((p, i) => (
                  <li key={i}>
                    <small className="text-500 mr-2">{time(p.at)}</small>
                    <span className="white-space-pre-wrap" style={{ overflowWrap: 'anywhere' }}>{p.text}</span>
                  </li>
                ))}
              </ol>
            )}
            {!allPrompts && data.prompts.length > PROMPTS_SHOWN && (
              <Button label={`Show all ${data.prompts.length} prompts`} text size="small" className="mt-2" onClick={() => setAllPrompts(true)} />
            )}
            {data.promptsOmitted > 0 && <small className="text-500 block mt-2">{data.promptsOmitted} later prompts not listed.</small>}
          </Card>
        </div>
      </div>
    </div>
  );
}
