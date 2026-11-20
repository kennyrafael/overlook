import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { Dialog } from 'primereact/dialog';
import { Message } from 'primereact/message';
import { Skeleton } from 'primereact/skeleton';
import { Tag } from 'primereact/tag';
import type { SummaryProject, WorkSummary } from '@overlook/shared';
import { api } from '../api';
import { formatDuration, formatUsd, localDay, relativeTime } from '../format';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';
import { appToast } from '../toast';
import { STATUS_LABEL, addDays, mondayOf, summaryMarkdown, weekTitle } from '../overview/summaryMarkdown';
import '../overview/daily.css';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function Kpi({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <Card className="h-full">
      <div className="flex justify-content-between align-items-start gap-2">
        <div>
          <div className="text-500 mb-2 text-sm">{label}</div>
          <div className="text-3xl font-bold">{value}</div>
        </div>
        <i className={`${icon} text-2xl text-primary`} />
      </div>
    </Card>
  );
}

function ProjectSummary({ p }: { p: SummaryProject }) {
  const other = p.moved.length - p.tasksCompleted;
  return (
    <Card className="summary-project h-full" data-testid="summary-project">
      <div className="flex justify-content-between align-items-start gap-2">
        <h3>{p.projectId ? <Link to={`/projects/${p.projectId}`} className="text-color no-underline hover:text-primary">{p.name}</Link> : p.name}</h3>
        <span className="flex flex-wrap gap-1 justify-content-end">
          {p.tasksCompleted > 0 && <Tag severity="success" value={`${p.tasksCompleted} done`} />}
          {p.commits > 0 && <Tag severity="info" value={`${p.commits} commit${p.commits === 1 ? '' : 's'}`} />}
          {p.sessions > 0 && <Tag severity="secondary" value={formatDuration(p.durationMs)} icon="pi pi-microchip-ai" />}
        </span>
      </div>

      {(p.moved.length > 0 || p.tasksAdded > 0 || p.tasksRemoved > 0) && (
        <>
          <div className="summary-section-title">Board</div>
          <ul className="summary-list">
            {p.moved.map((m, i) => (
              <li key={i}>
                <i className={m.to === 'done' ? 'pi pi-check-circle text-green-500' : 'pi pi-arrow-right text-500'} />
                <span className="summary-text" title={m.taskText}>{m.taskText}</span>
                <small className="text-500 white-space-nowrap">{STATUS_LABEL[m.from!]} → {STATUS_LABEL[m.to!]}</small>
              </li>
            ))}
          </ul>
          {(p.tasksAdded > 0 || p.tasksRemoved > 0 || other > 0) && (
            <small className="text-500">
              {[other > 0 && `${other} moved`, p.tasksAdded > 0 && `${p.tasksAdded} added`, p.tasksRemoved > 0 && `${p.tasksRemoved} removed`].filter(Boolean).join(' · ')}
            </small>
          )}
        </>
      )}

      {p.commits > 0 && (
        <>
          <div className="summary-section-title">Commits ({p.commits})</div>
          <ul className="summary-list">
            {p.recentCommits.map((c) => (
              <li key={c.hash}>
                <span className="summary-hash" title={c.hash}>{c.hash.slice(0, 7)}</span>
                <span className="summary-text" title={c.subject}>{c.subject}</span>
                {c.repo && <small className="text-500 white-space-nowrap">{c.repo}</small>}
              </li>
            ))}
          </ul>
          {p.commits > p.recentCommits.length && <small className="text-500">…and {p.commits - p.recentCommits.length} more</small>}
        </>
      )}

      {p.sessions > 0 && (
        <>
          <div className="summary-section-title">Claude</div>
          <span>{p.sessions} session{p.sessions === 1 ? '' : 's'} · {formatDuration(p.durationMs)} · {formatUsd(p.costUsd)} <small className="text-500">estimated</small></span>
        </>
      )}
    </Card>
  );
}

/** Weekly summary: per project, what moved on the board, commits, Claude time and cost. */
export default function SummaryPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('week');
  const monday = useMemo(() => mondayOf(raw && DAY_RE.test(raw) ? new Date(`${raw}T00:00:00`) : new Date()), [raw]);
  const from = localDay(monday);
  const to = localDay(addDays(monday, 6));
  const thisWeek = localDay(mondayOf(new Date()));
  const title = weekTitle(monday);

  const [data, setData] = useState<WorkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.summary(from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [from, to]);

  useEffect(() => { setData(null); load(); }, [load]);
  const changes = useLive((s) => `${s.git}|${s.claude}|${s.snapshots}`);
  useOnChange(changes, () => { if (from === thisWeek) load(); });

  const go = (d: Date) => {
    const m = localDay(mondayOf(d));
    setParams(m === thisWeek ? {} : { week: m }, { replace: true });
  };

  const markdown = data ? summaryMarkdown(data, title) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      appToast.current?.show({ severity: 'success', summary: 'Copied as Markdown', detail: 'Paste it into a standup or a note.', life: 2500 });
    } catch {
      setFallback(markdown); // clipboard blocked: show the text to copy by hand
    }
  };

  return (
    <div className="flex flex-column gap-3">
      <div className="summary-toolbar">
        <Button icon="pi pi-chevron-left" rounded text aria-label="Previous week" onClick={() => go(addDays(monday, -7))} />
        <span className="summary-week" data-testid="summary-week">
          {title} <small className="text-500 font-normal">· {fmt.format(monday)} – {fmt.format(addDays(monday, 6))}</small>
        </span>
        <Button icon="pi pi-chevron-right" rounded text aria-label="Next week" disabled={from >= thisWeek} onClick={() => go(addDays(monday, 7))} />
        <Calendar value={monday} onChange={(e) => e.value && go(e.value as Date)} showWeek maxDate={new Date()}
          showIcon iconPos="left" inputClassName="sr-only" className="w-auto" aria-label="Pick a week" />
        {from !== thisWeek && <Button label="This week" size="small" text onClick={() => go(new Date())} />}
        <span className="flex-1" />
        {data && <small className="text-500">Updated {relativeTime(data.generatedAt)}</small>}
        <Button label="Copy as Markdown" icon="pi pi-copy" size="small" disabled={!data} onClick={copy} />
      </div>

      {error && <Message severity="error" text={`Could not build the summary: ${error}`} />}
      {!data && !error && <Skeleton height="16rem" />}
      {data && (
        <>
          <div className="grid">
            <div className="col-6 md:col-4 xl:col-2"><Kpi label="Tasks done" value={data.totals.tasksCompleted} icon="pi pi-check-circle" /></div>
            <div className="col-6 md:col-4 xl:col-2"><Kpi label="Tasks moved" value={data.totals.tasksMoved} icon="pi pi-arrow-right-arrow-left" /></div>
            <div className="col-6 md:col-4 xl:col-2"><Kpi label="Commits" value={data.totals.commits} icon="pi pi-history" /></div>
            <div className="col-6 md:col-4 xl:col-2"><Kpi label="Claude sessions" value={data.totals.sessions} icon="pi pi-microchip-ai" /></div>
            <div className="col-6 md:col-4 xl:col-2"><Kpi label="Claude time" value={formatDuration(data.totals.durationMs)} icon="pi pi-clock" /></div>
            <div className="col-6 md:col-4 xl:col-2"><Kpi label="Estimated cost" value={formatUsd(data.totals.costUsd)} icon="pi pi-dollar" /></div>
          </div>
          {data.projects.length === 0
            ? <Message severity="info" text="Nothing recorded this week: no board moves, commits or Claude sessions." />
            : (
              <div className="grid">
                {data.projects.map((p) => (
                  <div key={p.projectId ?? 'other'} className="col-12 lg:col-6 xl:col-4"><ProjectSummary p={p} /></div>
                ))}
              </div>
            )}
          <small className="text-500">
            Board moves are recorded while Overlook runs (or on its next start); commits are on each repository's checked-out branch.
            Costs are estimates at API list prices.
          </small>
        </>
      )}

      <Dialog header="Copy as Markdown" visible={fallback !== null} onHide={() => setFallback(null)} style={{ width: 'min(48rem, 95vw)' }}>
        <p className="mt-0 text-500">The clipboard is not available here. Select the text and copy it.</p>
        <textarea className="summary-markdown p-inputtext" readOnly value={fallback ?? ''} aria-label="Summary as Markdown"
          ref={(el) => { if (el) { el.focus(); el.select(); } }} />
      </Dialog>
    </div>
  );
}
