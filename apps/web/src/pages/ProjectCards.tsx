import { Link } from 'react-router-dom';
import { Button } from 'primereact/button';
import { ProgressBar } from 'primereact/progressbar';
import { Tag } from 'primereact/tag';
import type { Project, ProjectPatch } from '@overlook/shared';
import { useFilters } from '../store/filters';
import { relativeTime, statusSeverity } from '../format';
import { ProjectActionsMenu } from '../actions/projectActions';
import { useLiveSessions } from '../tasks/useLiveSessions';
import type { LiveSession } from '@overlook/shared';

/** "Claude is working" line for a project with a live session (the most recent one, plus a count). */
function LiveLine({ sessions }: { sessions: LiveSession[] }) {
  const working = sessions.filter((s) => s.state === 'working');
  const s = working[0] ?? sessions[0];
  const label = working.length > 1 ? `${working.length} Claude sessions working` : working.length ? 'Claude is working' : 'Claude is idle';
  const detail = s.current ? `Now: ${s.current}` : s.title;
  return (
    <div className="project-card-live" title={[s.title, s.current && `Now: ${s.current}`].filter(Boolean).join('\n')}>
      <span className={`live-dot ${working.length ? 'live-dot-working' : ''}`} aria-hidden />
      <span className="font-semibold">{label}</span>
      {detail && <span className="project-card-live-detail">· {detail}</span>}
    </div>
  );
}

interface Props {
  projects: Project[];
  onUpdate: (id: string, patch: ProjectPatch) => Promise<void>;
  onEdit: (project: Project) => void;
}

/** The Projects page as a grid of cards: one card per project, the whole card opens it. */
export default function ProjectCards({ projects, onUpdate, onEdit }: Props) {
  const filters = useFilters();
  const { sessions } = useLiveSessions(projects.map((p) => p.id));
  const liveBy = new Map<string, LiveSession[]>();
  for (const s of sessions) liveBy.set(s.projectId, [...(liveBy.get(s.projectId) ?? []), s]);
  return (
    <ul className="project-cards" aria-label="Projects">
      {projects.map((p) => (
        <li key={p.id} className="project-card">
          <div className="project-card-top">
            <Button icon={p.pinned ? 'pi pi-star-fill' : 'pi pi-star'} rounded text size="small"
              className="project-card-pin project-card-control"
              severity={p.pinned ? 'warning' : 'secondary'} aria-label={p.pinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
              onClick={() => onUpdate(p.id, { pinned: !p.pinned }).catch(() => {})} />
            <Link to={`/projects/${p.id}`} className="project-card-name">{p.name}</Link>
            <Tag severity={statusSeverity[p.status]} value={p.status}
              icon={p.statusOverridden ? 'pi pi-lock' : undefined}
              className="cursor-pointer status-tag project-card-control"
              data-pr-tooltip={p.statusOverridden ? 'Set manually · click to filter' : 'Derived from activity · click to filter'}
              onClick={() => filters.toggle('statuses', p.status)} />
          </div>
          <span className="project-card-path" title={p.path}>{p.path}</span>
          {!p.exists && <Tag severity="danger" value="missing" className="align-self-start" />}
          {liveBy.has(p.id) && <LiveLine sessions={liveBy.get(p.id)!} />}

          <div>
            <ProgressBar value={p.progress} showValue={false} style={{ height: '0.45rem' }}
              aria-label={`${p.name} progress`} />
            <div className="project-card-meta">
              <span>
                {p.milestonesTotal
                  ? `${p.progress}% · ${p.milestonesReached}/${p.milestonesTotal} milestones`
                  : 'No plan'}
              </span>
              <span title={p.lastActivityAt ?? ''}>{relativeTime(p.lastActivityAt)}</span>
            </div>
          </div>

          {(p.markers.length > 0 || p.tags.length > 0) && (
            <div className="project-card-chips">
              {p.markers.map((m) => <span key={`m-${m}`} className="project-card-marker">{m}</span>)}
              {p.tags.map((t) => (
                <Tag key={`t-${t}`} value={t} severity="secondary" rounded className="cursor-pointer project-card-control"
                  onClick={() => filters.toggle('tags', t)} />
              ))}
            </div>
          )}

          <div className="project-card-foot">
            <span className="project-card-sessions" title="Claude Code sessions">
              <i className="pi pi-microchip-ai text-primary mr-1" />{p.claudeSessions}
              <span className="sr-only"> sessions</span>
            </span>
            {p.milestonesTotal > 0 && (
              <span className="project-card-sessions">{p.tasksDone}/{p.tasksTotal} tasks</span>
            )}
            <span className="ml-auto flex project-card-control">
              <ProjectActionsMenu project={p} />
              <Button icon="pi pi-pencil" rounded text aria-label={`Edit ${p.name}`} onClick={() => onEdit(p)} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
