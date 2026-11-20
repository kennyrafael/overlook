import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskSessionRef } from '@overlook/shared';
import { api } from '../api';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';

/** Above this many projects (the all-projects board) the links are not loaded: one request per project. */
const MAX_PROJECTS = 8;

/**
 * Recent Claude sessions that worked on each plan task, keyed `projectId|taskId`. The server matches
 * sessions to tasks from their titles and prompts; nothing is stored. Reloads when Claude logs or plans change.
 */
export function useTaskSessions(projectIds: string[]) {
  const key = projectIds.length <= MAX_PROJECTS ? projectIds.join(',') : '';
  const [links, setLinks] = useState<Map<string, TaskSessionRef[]>>(new Map());

  const load = useCallback(() => {
    if (!key) { setLinks(new Map()); return; }
    const ids = key.split(',');
    Promise.all(ids.map((id) => api.taskSessions(id).then((r) => [id, r] as const).catch(() => [id, {}] as const)))
      .then((all) => {
        const m = new Map<string, TaskSessionRef[]>();
        for (const [pid, byTask] of all) for (const [taskId, list] of Object.entries(byTask)) m.set(`${pid}|${taskId}`, list);
        setLinks(m);
      });
  }, [key]);

  useEffect(load, [load]);
  // A live session writes its log many times a minute; links change slowly, so reload at most every 30 s for that.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useOnChange(useLive((s) => s.claude), () => {
    timer.current ??= setTimeout(() => { timer.current = null; load(); }, 30_000);
  });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useOnChange(useLive((s) => key.split(',').map((i) => s.projects[i] ?? 0).join(',')), load);

  return links;
}
