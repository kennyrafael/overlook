import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LiveSession } from '@overlook/shared';
import { api } from '../api';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';

/** Re-check this often while a session is shown, so one that goes quiet turns idle, then disappears. */
const POLL_MS = 60_000;
const DISMISSED_KEY = 'overlook.dismissedSuggestions';

function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')); } catch { return new Set(); }
}

/**
 * Live Claude sessions of the given projects, refreshed when their logs change
 * (claude:updated) or their plan changes, and polled while any is shown.
 */
export function useLiveSessions(projectIds: string[]) {
  const key = projectIds.join(',');
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [dismissed, setDismissed] = useState(loadDismissed);

  const load = useCallback(() => {
    if (!key) { setSessions([]); return; }
    api.live(key.split(',')).then(setSessions).catch(() => { /* keep the last answer */ });
  }, [key]);

  useEffect(load, [load]);

  const claude = useLive((s) => s.claude);
  useOnChange(claude, () => {
    const touched = useLive.getState().lastClaudeIds;
    if (!touched.length || touched.some((id) => key.split(',').includes(id))) load();
  });
  const plans = useLive((s) => key.split(',').map((i) => s.projects[i] ?? 0).join(','));
  useOnChange(plans, load);

  useEffect(() => {
    if (!sessions.length) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [sessions.length, load]);

  const dismiss = useCallback((sessionId: string, taskId: string) => {
    setDismissed((d) => {
      const next = new Set(d).add(`${sessionId}|${taskId}`);
      // Keep the list short; old sessions never come back.
      try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-200))); } catch { /* private mode */ }
      return next;
    });
  }, []);

  /** Task key (`projectId|taskId`) → the live session that suggests it. */
  const suggestions = useMemo(() => {
    const m = new Map<string, LiveSession>();
    for (const s of sessions) {
      if (!s.suggestion || dismissed.has(`${s.id}|${s.suggestion.taskId}`)) continue;
      const k = `${s.projectId}|${s.suggestion.taskId}`;
      if (!m.has(k)) m.set(k, s);
    }
    return m;
  }, [sessions, dismissed]);

  return { sessions, suggestions, dismiss, reload: load };
}
