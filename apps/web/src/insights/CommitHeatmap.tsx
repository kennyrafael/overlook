import { useMemo } from 'react';
import { Tooltip } from 'primereact/tooltip';
import { localDay } from '../format';
import { useTheme } from '../theme/ThemeContext';

// One blue hue; the step nearest zero recedes toward the surface in each mode.
const STEPS = {
  light: ['#cde2fb', '#86b6ef', '#3987e5', '#256abf', '#104281'],
  dark: ['#104281', '#1c5cab', '#2a78d6', '#5598e7', '#9ec5f4'],
};

interface Props {
  counts: Record<string, number>;
  days?: number;
  onSelectDay?: (day: string) => void;
}

const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/** Calendar heatmap of commits per day: columns are weeks (Mon–Sun), newest on the right. */
export default function CommitHeatmap({ counts, days = 91 }: Props) {
  const { mode } = useTheme();
  const { weeks, max, total, monthLabels } = useMemo(() => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    // Align the first column to Monday.
    const offset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - offset);

    const cells: { day: string; count: number; future: boolean; outside: boolean }[] = [];
    const firstShown = new Date(end);
    firstShown.setDate(firstShown.getDate() - (days - 1));
    for (const d = new Date(start); d <= end || cells.length % 7 !== 0; d.setDate(d.getDate() + 1)) {
      const day = localDay(d);
      cells.push({ day, count: counts[day] ?? 0, future: d > end, outside: d < firstShown });
    }
    const weeks: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const visible = cells.filter((c) => !c.future && !c.outside);
    const max = Math.max(0, ...visible.map((c) => c.count));
    const total = visible.reduce((s, c) => s + c.count, 0);
    const monthLabels = weeks.map((w, i) => {
      const m = new Date(w[0].day + 'T00:00:00').toLocaleString(undefined, { month: 'short' });
      const prev = i ? new Date(weeks[i - 1][0].day + 'T00:00:00').toLocaleString(undefined, { month: 'short' }) : '';
      return m !== prev ? m : '';
    });
    return { weeks, max, total, monthLabels };
  }, [counts, days]);

  const steps = STEPS[mode];
  const color = (n: number) => {
    if (!n || !max) return 'var(--surface-hover)';
    const i = Math.min(steps.length - 1, Math.floor((n / max) * steps.length - 1e-9));
    return steps[Math.max(0, i)];
  };

  return (
    <div className="flex flex-column gap-2">
      <Tooltip target=".heat-cell" position="top" mouseTrack mouseTrackTop={12} />
      <div className="heatmap" role="img" aria-label={`${total} commits in the last ${days} days`}>
        <div className="heatmap-weekdays">{WEEKDAYS.map((d, i) => <span key={i} style={{ gridRow: i + 2 }}>{d}</span>)}</div>
        <div className="heatmap-grid">
          {weeks.map((w, wi) => (
            <div key={wi} className="heatmap-week">
              <span className="heatmap-month">{monthLabels[wi]}</span>
              {w.map((c) => (
                <span
                  key={c.day}
                  className={c.future || c.outside ? 'heat-cell heat-cell-empty' : 'heat-cell'}
                  style={{ background: c.future || c.outside ? 'transparent' : color(c.count) }}
                  data-pr-tooltip={c.future || c.outside ? undefined : `${c.count} commit${c.count === 1 ? '' : 's'} · ${new Date(c.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex align-items-center gap-2 text-500 text-sm">
        <span>{total} commits</span>
        <span className="ml-auto">Less</span>
        <span className="heat-legend" style={{ background: 'var(--surface-hover)' }} />
        {steps.map((s) => <span key={s} className="heat-legend" style={{ background: s }} />)}
        <span>More</span>
      </div>
    </div>
  );
}
