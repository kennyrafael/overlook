import { useEffect, useState } from 'react';
import type { Milestone, Task } from '@overlook/shared';
import { DEFAULT_SETTINGS } from '@overlook/shared';
import { api } from '../api';

const DAY_MS = 86_400_000;

/** Today as YYYY-MM-DD in local time (due dates are calendar days, not instants). */
export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** A milestone's due date, whether it is overdue (past and not reached), and a label for it. */
export function dueInfo(m: Pick<Milestone, 'due' | 'reached'>): { overdue: boolean; label: string } | null {
  if (!m.due) return null;
  const [y, mo, d] = m.due.split('-').map(Number);
  const date = new Date(y, mo - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const overdue = !m.reached && m.due < todayLocal();
  return { overdue, label: overdue ? `Overdue since ${date}` : `Due ${date}` };
}

/** Whole days an in-progress task has been in progress, from its git blame time; null when unknown. */
export function daysInProgress(t: Pick<Task, 'status' | 'inProgressSince'>, now = Date.now()): number | null {
  if (t.status !== 'in_progress' || !t.inProgressSince) return null;
  return Math.floor((now - Date.parse(t.inProgressSince)) / DAY_MS);
}

/** In progress for more than `limitDays` days (unknown ages are never stale). */
export function isStale(t: Pick<Task, 'status' | 'inProgressSince'>, limitDays: number, now = Date.now()): boolean {
  if (t.status !== 'in_progress' || !t.inProgressSince) return false;
  return now - Date.parse(t.inProgressSince) > limitDays * DAY_MS;
}

/** Settings → staleTaskDays, read once per mounted component (it changes rarely). */
export function useStaleTaskDays(): number {
  const [days, setDays] = useState(DEFAULT_SETTINGS.staleTaskDays);
  useEffect(() => {
    let live = true;
    api.settings().then((s) => { if (live && s.staleTaskDays >= 1) setDays(s.staleTaskDays); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return days;
}
