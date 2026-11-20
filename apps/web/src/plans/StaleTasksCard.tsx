import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Tag } from 'primereact/tag';
import type { StaleTask } from '@overlook/shared';
import { api } from '../api';
import { useLive } from '../store/live';
import { useOnChange } from '../store/useOnChange';

const SHOWN = 8;

interface Props {
  /** Only tasks of these projects are listed (the projects the page shows). */
  projectIds: string[];
  /** Wrapper (grid column) classes; nothing at all is rendered when no task is stale. */
  className?: string;
}

/**
 * Overview card: in-progress tasks whose checkbox line has not changed in git for longer than
 * Settings → "Task stale after". Hidden when there are none.
 */
export default function StaleTasksCard({ projectIds, className }: Props) {
  const [tasks, setTasks] = useState<StaleTask[] | null>(null);
  const load = useCallback(() => { api.staleTasks().then(setTasks).catch(() => setTasks([])); }, []);
  useEffect(load, [load]);
  // Any plan edit can start or end a stale task.
  const liveKey = useLive((s) => Object.values(s.projects).reduce((a, b) => a + b, 0));
  useOnChange(liveKey, load);

  const ids = new Set(projectIds);
  const shown = (tasks ?? []).filter((t) => ids.has(t.projectId));
  if (!shown.length) return null;
  return (
    <div className={className}>
      <Card title="Stale in progress" subTitle="In progress, and the line has not changed in git since" className="h-full stale-tasks">
        <ul className="list-none m-0 p-0 flex flex-column gap-2">
          {shown.slice(0, SHOWN).map((t) => (
            <li key={`${t.projectId}|${t.taskId}`} className="flex align-items-center gap-2 min-w-0">
              <Tag value={`${t.days} d`} severity={t.days >= 30 ? 'danger' : 'warning'} title={`In progress since ${new Date(t.since).toLocaleDateString()}`} />
              <Link to={`/projects/${t.projectId}`} className="text-primary no-underline white-space-nowrap">{t.projectName}</Link>
              <span className="white-space-nowrap overflow-hidden text-overflow-ellipsis" title={`${t.text} · ${t.milestoneTitle} · ${t.relFile}:${t.line}`}>{t.text}</span>
            </li>
          ))}
        </ul>
        {shown.length > SHOWN && <small className="text-500">and {shown.length - SHOWN} more</small>}
      </Card>
    </div>
  );
}
