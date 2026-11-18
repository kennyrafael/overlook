import { useEffect, useMemo, useState } from 'react';
import { Card } from 'primereact/card';
import { Chart } from 'primereact/chart';
import { SelectButton } from 'primereact/selectbutton';
import { Skeleton } from 'primereact/skeleton';
import type { ProgressPoint } from '@overlook/shared';
import { api } from '../api';
import { baseOptions, chartTokens, withAlpha } from '../chartTheme';
import { useLive } from '../store/live';
import { useTheme } from '../theme/ThemeContext';

type Unit = 'milestones' | 'tasks';

interface Props {
  projectIds?: string[];
  title?: string;
}

/**
 * Burnup: scope (total) vs. reached/done over time, from daily snapshots
 * (backfilled from the plan files' git history, then recorded live).
 */
export default function ProgressChart({ projectIds, title = 'Progress over time' }: Props) {
  const { version: themeVersion } = useTheme();
  const snapshotsVersion = useLive((s) => s.snapshots);
  const [unit, setUnit] = useState<Unit>('milestones');
  const [days, setDays] = useState(90);
  const [points, setPoints] = useState<ProgressPoint[] | null>(null);
  const key = projectIds?.join(',') ?? 'all';

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ days: String(days) });
    if (projectIds) q.set('projects', projectIds.join(','));
    fetch(`/api/insights/progress?${q}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((p: ProgressPoint[]) => { if (!cancelled) setPoints(p); })
      .catch(() => { if (!cancelled) setPoints([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, days, snapshotsVersion]);

  const chart = useMemo(() => {
    if (!points?.length) return null;
    const t = chartTokens();
    const base = baseOptions(t);
    const done = points.map((p) => (unit === 'milestones' ? p.milestonesReached : p.tasksDone));
    const scope = points.map((p) => (unit === 'milestones' ? p.milestonesTotal : p.tasksTotal));
    const label = unit === 'milestones' ? 'Milestones reached' : 'Tasks done';
    const last = points.length - 1;
    return {
      summary: `${done[last]} of ${scope[last]} ${unit}`,
      data: {
        labels: points.map((p) => new Date(p.date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })),
        datasets: [
          {
            label: 'Scope',
            data: scope,
            borderColor: t.muted,
            backgroundColor: t.muted, // legend swatch only (fill is off)
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            stepped: 'before',
            fill: false,
          },
          {
            label,
            data: done,
            borderColor: t.primary,
            backgroundColor: withAlpha(t.primary, 0.15),
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            stepped: 'before',
            fill: 'origin',
          },
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
              footer: (items: { dataIndex: number }[]) => {
                const i = items[0]?.dataIndex ?? 0;
                return scope[i] ? `${Math.round((done[i] / scope[i]) * 100)}% complete` : '';
              },
            },
          },
        },
        scales: {
          x: { ...base.scales.x, grid: { display: false }, ticks: { ...base.scales.x.ticks, maxRotation: 0, autoSkipPadding: 16 } },
          y: { ...base.scales.y, beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.muted, precision: 0 } },
        },
      },
    };
  }, [points, unit, themeVersion]);

  return (
    <Card title={title} subTitle={chart ? `${chart.summary} · history from git, then recorded daily` : undefined} className="h-full">
      <div className="flex flex-wrap gap-2 mb-2">
        <SelectButton value={unit} onChange={(e) => e.value && setUnit(e.value)}
          options={[{ label: 'Milestones', value: 'milestones' }, { label: 'Tasks', value: 'tasks' }]} />
        <SelectButton value={days} onChange={(e) => e.value && setDays(e.value)}
          options={[{ label: '30 d', value: 30 }, { label: '90 d', value: 90 }]} />
      </div>
      {points === null ? <Skeleton height="240px" /> : !chart ? (
        <p className="text-500 m-0">No history yet. Progress is recorded daily for projects with a plan; history is also rebuilt from the plan files' git commits.</p>
      ) : (
        <div style={{ height: 260 }}>
          <Chart type="line" data={chart.data} options={chart.options} style={{ height: '100%' }} />
        </div>
      )}
    </Card>
  );
}
