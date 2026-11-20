import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LiveSession } from '@overlook/shared';
import { api } from '../api';
import { desktop } from '../desktop';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';
import { useProjects } from '../store/projects';

/** Re-read live sessions at most this often when logs change, and poll this often while one is working. */
const THROTTLE_MS = 3_000;
const POLL_MS = 30_000;

/** A session that was working and has now ended its turn (Claude is waiting for the user). */
export function newlyWaiting(prev: Map<string, boolean>, now: LiveSession[]): LiveSession[] {
  return now.filter((s) => s.waiting && prev.get(s.id) === true);
}

/**
 * App-wide: tells the user when a Claude Code session finishes its turn and waits for them.
 * In the desktop app this is a native notification (Settings → Desktop app; click opens the project).
 * In a browser tab, the tab title shows "Claude is waiting" while the tab is in the background.
 */
export function useWaitingNotifier() {
  const navigate = useNavigate();
  /** Session id → was working at the last look. Sessions seen first while idle never notify. */
  const working = useRef(new Map<string, boolean>());
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseTitle = useRef(document.title);

  useEffect(() => {
    desktop?.onOpenProject?.((id) => navigate(`/projects/${encodeURIComponent(id)}`));
  }, [navigate]);

  const check = useRef(async () => {
    last.current = Date.now();
    let sessions: LiveSession[];
    try { sessions = await api.live(); } catch { return; }
    const waiting = newlyWaiting(working.current, sessions);
    working.current = new Map(sessions.map((s) => [s.id, s.state === 'working' && !s.waiting]));
    if (waiting.length) await announce(waiting);
    if (sessions.some((s) => s.state === 'working')) schedule(POLL_MS);
  });

  const schedule = (ms: number) => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; void check.current(); }, ms);
  };

  const announce = async (list: LiveSession[]) => {
    const names = new Map(useProjects.getState().projects.map((p) => [p.id, p.name]));
    if (desktop?.notify) {
      const prefs = await desktop.getPrefs().catch(() => null);
      if (!prefs?.notifyWaiting) return;
      const muted = new Set(prefs.mutedProjects ?? []);
      for (const s of list) {
        if (muted.has(s.projectId)) continue;
        const name = names.get(s.projectId) ?? 'A project';
        void desktop.notify({ title: `${name}: Claude is waiting`, body: s.title ?? s.current ?? 'The session finished its turn.', projectId: s.projectId });
      }
      return;
    }
    if (document.hidden) document.title = `● Claude is waiting · ${baseTitle.current}`;
  };

  useEffect(() => {
    void check.current();
    const reset = () => { if (!document.hidden) document.title = baseTitle.current; };
    document.addEventListener('visibilitychange', reset);
    return () => {
      document.removeEventListener('visibilitychange', reset);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useOnChange(useLive((s) => s.claude), () => {
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - last.current));
    if (wait === 0 && !timer.current) void check.current();
    else schedule(wait);
  });
}
