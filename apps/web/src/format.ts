import type { ProjectSource, ProjectStatus } from '@overlook/shared';

type Severity = 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast';

export const statusSeverity: Record<ProjectStatus, Severity> = {
  active: 'success',
  paused: 'warning',
  blocked: 'danger',
  done: 'info',
  archived: 'secondary',
};

export const sourceLabel: Record<ProjectSource, string> = {
  root: 'Folder scan',
  claude: 'Claude history',
  both: 'Scan + Claude',
};

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800],
    ['day', 86_400], ['hour', 3_600], ['minute', 60],
  ];
  for (const [unit, sec] of units) {
    if (Math.abs(diffSec) >= sec) return rtf.format(Math.round(diffSec / sec), unit);
  }
  return 'just now';
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const formatCompact = (n: number) => compact.format(n);
export const formatUsd = (n: number) => (Math.abs(n) >= 1000 ? usdWhole : usd).format(n);

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

/** Local calendar date (YYYY-MM-DD). */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
