import { Link } from 'react-router-dom';
import { Button } from 'primereact/button';
import { ProgressBar } from 'primereact/progressbar';
import { Tag } from 'primereact/tag';
import type { Project, ProjectPatch } from '@overlook/shared';
import { useFilters } from '../store/filters';
import { relativeTime, statusSeverity } from '../format';
import { ProjectActionsMenu } from '../actions/projectActions';

interface Props {
  projects: Project[];
  onUpdate: (id: string, patch: ProjectPatch) => Promise<void>;
  onEdit: (project: Project) => void;
}

/** The Projects page as a grid of cards: one card per project, the whole card opens it. */
export default function ProjectCards({ projects, onUpdate, onEdit }: Props) {
  const filters = useFilters();
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
