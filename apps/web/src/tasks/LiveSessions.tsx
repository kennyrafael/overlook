import { useState } from 'react';
import { Button } from 'primereact/button';
import type { LiveSession } from '@overlook/shared';
import { relativeTime } from '../format';
import { resumeInDesktopApp, resumeSession, useClaudeAvailable } from '../actions/projectActions';

/**
 * "Claude is working" strip above the board: one row per session with recent activity, with the
 * step Claude marked in progress. Read from the session log; it never claims a plan task by itself.
 */
const DISMISSED_KEY = 'overlook.dismissedIdleSessions';

/** Dismissed idle sessions, as session id → the lastActivityAt it was dismissed at (new activity brings it back). */
function loadDismissed(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') ?? {}; } catch { return {}; }
}

export default function LiveSessions({ sessions: all, projectName }: { sessions: LiveSession[]; projectName?: (id: string) => string | undefined }) {
  const [open, setOpen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, string>>(loadDismissed);
  const claudeOk = useClaudeAvailable();
  const sessions = all.filter((s) => !(s.state === 'idle' && dismissed[s.id] === s.lastActivityAt));
  const dismiss = (s: LiveSession) => {
    // Keep only entries for sessions still listed, so the stored map does not grow forever.
    const next = Object.fromEntries(Object.entries(dismissed).filter(([id]) => all.some((x) => x.id === id)));
    next[s.id] = s.lastActivityAt;
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* not persisted */ }
  };
  if (!sessions.length) return null;
  return (
    <div className="flex flex-column gap-2" aria-label="Live Claude sessions">
      {sessions.map((s) => {
        const done = s.steps.filter((x) => x.status === 'done').length;
        const expanded = open === s.id;
        const name = projectName?.(s.projectId);
        return (
          <div key={s.id} className="live-session surface-card border-1 surface-border border-round px-3 py-2">
            <div className="flex flex-wrap align-items-center gap-2">
              <span className={`live-dot ${s.state === 'working' ? 'live-dot-working' : ''}`} aria-hidden />
              <span className="font-semibold">{s.state === 'working' ? 'Claude is working' : 'Claude is idle'}</span>
              {name && <span className="text-500">in {name}</span>}
              {s.title && <span className="text-600 live-title" title={s.title}>· {s.title}</span>}
              <small className="text-500 ml-auto">{relativeTime(s.lastActivityAt)}</small>
              {claudeOk && s.state === 'idle' && (
                // Idle only: resuming a session that is still running in a terminal would start a second copy.
                <Button text size="small" className="p-1" icon="pi pi-replay" label="Resume"
                  title="Continue this session in a new terminal (claude --resume)"
                  onClick={() => { void resumeSession(s.projectId, s.id, s.title); }} />
              )}
              {s.state === 'idle' && (
                <Button text size="small" className="p-1" icon="pi pi-external-link" label="Claude app"
                  title="Start a new session in the Claude desktop app that picks up from this one's transcript"
                  onClick={() => { void resumeInDesktopApp(s.projectId, s.id); }} />
              )}
              {s.steps.length > 0 && (
                <Button text size="small" className="p-1" icon={expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'}
                  label={`${done}/${s.steps.length} steps`} aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : s.id)} />
              )}
              {s.state === 'idle' && (
                <Button text rounded size="small" className="p-1" icon="pi pi-times" aria-label="Dismiss"
                  title="Hide this idle session (it comes back if Claude works in it again)"
                  onClick={() => dismiss(s)} />
              )}
            </div>
            {s.current && !expanded && (
              <div className="text-sm text-600 mt-1 live-now"><i className="pi pi-angle-right text-xs mr-1" />Now: {s.current}</div>
            )}
            {expanded && (
              <ol className="live-steps m-0 mt-2 pl-4 text-sm">
                {s.steps.map((st, i) => (
                  <li key={i} className={st.status === 'done' ? 'text-500 line-through' : st.status === 'in_progress' ? 'font-semibold' : 'text-600'}>
                    {st.text}
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Shown inside a To do card when a live session looks like it is on that task. */
export function TaskSuggestion({ onAccept, onDismiss }: { onAccept: () => void; onDismiss: () => void }) {
  // Stop pointer events so the buttons do not start a drag or open the task dialog.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="live-suggestion border-round p-2 mt-2 flex flex-wrap align-items-center gap-2 text-sm"
      onPointerDown={stop} onClick={stop} onKeyDown={stop}>
      <span className="flex align-items-center gap-1"><span className="live-dot live-dot-working" aria-hidden />Claude may be on this</span>
      <span className="flex gap-1 ml-auto">
        <Button size="small" className="py-1 px-2" label="Mark in progress" onClick={onAccept} />
        <Button size="small" text className="py-1 px-2" icon="pi pi-times" aria-label="Not this task" title="Not this task" onClick={onDismiss} />
      </span>
    </div>
  );
}
