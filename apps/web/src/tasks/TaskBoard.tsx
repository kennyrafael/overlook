import { useCallback, useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { MultiSelect } from 'primereact/multiselect';
import { InputText } from 'primereact/inputtext';
import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { Badge } from 'primereact/badge';
import type { Milestone, ProjectDetail, Task, TaskStatus } from '@overlook/shared';
import TaskDialog, { type TaskDialogState } from './TaskDialog';
import { TASK_STATUS_LABEL, useTaskActions } from './useTaskActions';
import LiveSessions, { TaskSuggestion } from './LiveSessions';
import { useLiveSessions } from './useLiveSessions';
import { useTaskSessions } from './useTaskSessions';
import { resumeSession, startClaudeOnTask, useClaudeAvailable } from '../actions/projectActions';
import { daysInProgress, dueInfo, isStale, useStaleTaskDays } from '../plans/planTrust';

const COLUMNS: { status: TaskStatus; icon: string; accent: string }[] = [
  { status: 'todo', icon: 'pi pi-circle', accent: 'var(--surface-400)' },
  { status: 'in_progress', icon: 'pi pi-spinner', accent: 'var(--yellow-500)' },
  { status: 'done', icon: 'pi pi-check-circle', accent: 'var(--green-500)' },
];

interface Card {
  key: string;
  project: ProjectDetail;
  milestone: Milestone;
  task: Task;
}

interface Props {
  projects: ProjectDetail[];
  onProjectChanged: (p: ProjectDetail) => void;
  onConflict?: () => void;
}

function TaskCard({ card, showProject, dragging, onOpen, suggestion, onStartClaude, sessions = 0, staleDays = null }: {
  card: Card; showProject: boolean; dragging?: boolean; onOpen?: () => void;
  /** Days in progress, when that is longer than Settings → staleTaskDays. */
  staleDays?: number | null;
  suggestion?: { onAccept: () => void; onDismiss: () => void };
  /** Shown for open tasks when Claude Code is installed. */
  onStartClaude?: () => void;
  /** Recent Claude sessions that worked on this task. */
  sessions?: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.key, data: card });
  // Keep the button's pointer and key events away from the drag sensor and the card's own click.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const due = dueInfo(card.milestone);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => { listeners?.onKeyDown?.(e); if (e.key === 'Enter' && onOpen) onOpen(); }}
      className="board-card surface-card border-1 surface-border border-round p-3 cursor-grab"
      style={{ opacity: isDragging && !dragging ? 0.35 : 1, boxShadow: dragging ? '0 8px 24px rgba(0,0,0,.35)' : undefined }}
      aria-label={`${card.task.text}. ${TASK_STATUS_LABEL[card.task.status]}. Press space to move.`}
    >
      <div className="flex flex-wrap gap-1 mb-2">
        {showProject && <Tag value={card.project.name} severity="info" />}
        <Tag value={card.milestone.title} severity={due?.overdue ? 'danger' : 'secondary'} className="board-milestone-tag"
          icon={due ? 'pi pi-calendar' : undefined} title={due ? `${card.milestone.title} · ${due.label}` : card.milestone.title} />
        {staleDays !== null && (
          <Tag value={`${staleDays} d`} severity="warning" icon="pi pi-hourglass" className="board-stale-tag" title={`In progress for ${staleDays} days (last change to this line in git)`} />
        )}
      </div>
      <div className={`board-card-text ${card.task.status === 'done' ? 'line-through text-500' : ''}`}>{card.task.text}</div>
      <div className="flex align-items-center gap-2 mt-2">
        <small className="text-500">{card.milestone.relFile}:{card.task.line}</small>
        {sessions > 0 && (
          <small className="text-500 flex align-items-center gap-1" title={`${sessions} recent Claude session${sessions === 1 ? '' : 's'} worked on this`}>
            <i className="pi pi-comments text-xs" />{sessions}
          </small>
        )}
        {onStartClaude && !dragging && (
          <Button icon="pi pi-play" rounded text size="small" className="board-card-claude ml-auto p-0" style={{ width: '1.75rem', height: '1.75rem' }}
            aria-label={`Start Claude on: ${card.task.text}`} title="Start Claude on this task"
            onPointerDown={stop} onKeyDown={stop} onClick={(e) => { e.stopPropagation(); onStartClaude(); }} />
        )}
      </div>
      {suggestion && <TaskSuggestion {...suggestion} />}
    </div>
  );
}

function Column({ status, icon, accent, cards, children, onAdd }: {
  status: TaskStatus; icon: string; accent: string; cards: number; children: React.ReactNode; onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="col-12 md:col-4">
      <div ref={setNodeRef} className="board-column border-round p-2 h-full"
        style={{ outline: isOver ? `2px dashed ${accent}` : undefined, borderTop: `3px solid ${accent}` }}>
        <div className="flex align-items-center justify-content-between px-1 pb-2">
          <span className="font-semibold flex align-items-center gap-2">
            <i className={icon} style={{ color: accent }} />{TASK_STATUS_LABEL[status]} <Badge value={cards} severity="secondary" />
          </span>
          <Button icon="pi pi-plus" rounded text size="small" aria-label={`Add task to ${TASK_STATUS_LABEL[status]}`} onClick={onAdd} />
        </div>
        <div className="flex flex-column gap-2">{children}</div>
      </div>
    </div>
  );
}

/**
 * Kanban over plan-file tasks. Dragging a card between columns rewrites its
 * checkbox ([ ] / [~] / [x]) in the markdown file. Order follows the file.
 */
export default function TaskBoard({ projects, onProjectChanged, onConflict }: Props) {
  const [milestoneFilter, setMilestoneFilter] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [hideReached, setHideReached] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const staleLimit = useStaleTaskDays();
  const [active, setActive] = useState<Card | null>(null);
  const [pending, setPending] = useState<Record<string, TaskStatus>>({});
  const [dialog, setDialog] = useState<TaskDialogState>(null);
  // On a conflict the open task is stale: close the dialog and reload.
  const handleConflict = useCallback(() => { setDialog(null); onConflict?.(); }, [onConflict]);
  const actions = useTaskActions(onProjectChanged, handleConflict);
  const multi = projects.length > 1;
  const live = useLiveSessions(projects.map((p) => p.id));
  const claudeOk = useClaudeAvailable();
  const linked = useTaskSessions(projects.map((p) => p.id));
  const startOn = (c: Card) => startClaudeOnTask(c.project, c.task);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Card[] = [];
    for (const project of projects) {
      for (const milestone of project.milestones) {
        if (milestoneFilter.length && !milestoneFilter.includes(`${project.id}|${milestone.id}`)) continue;
        if (hideReached && milestone.reached) continue;
        for (const task of milestone.tasks) {
          if (q && !task.text.toLowerCase().includes(q) && !milestone.title.toLowerCase().includes(q)) continue;
          if (staleOnly && !isStale(task, staleLimit)) continue;
          out.push({ key: `${project.id}|${task.id}`, project, milestone, task });
        }
      }
    }
    return out;
  }, [projects, milestoneFilter, query, hideReached, staleOnly, staleLimit]);
  const staleCount = useMemo(() => projects.reduce((n, p) => n + p.milestones.reduce((m, ms) => m + ms.tasks.filter((t) => isStale(t, staleLimit)).length, 0), 0), [projects, staleLimit]);
  const staleDaysOf = (c: Card) => (isStale(c.task, staleLimit) ? daysInProgress(c.task) : null);

  const statusOf = useCallback((c: Card) => pending[c.key] ?? c.task.status, [pending]);

  const milestoneOptions = projects.flatMap((p) => p.milestones.map((m) => ({
    label: multi ? `${p.name} › ${m.title}` : m.title,
    value: `${p.id}|${m.id}`,
  })));

  const onDragStart = (e: DragStartEvent) => setActive(e.active.data.current as Card);

  const onDragEnd = async (e: DragEndEvent) => {
    setActive(null);
    const card = e.active.data.current as Card | undefined;
    const to = e.over?.id as TaskStatus | undefined;
    if (card && to) await move(card, to);
  };

  const move = async (card: Card, to: TaskStatus) => {
    if (statusOf(card) === to) return;
    setPending((p) => ({ ...p, [card.key]: to })); // optimistic
    await actions.setStatus(card.project.id, card.task, to);
    setPending((p) => { const { [card.key]: _drop, ...rest } = p; return rest; });
  };

  const openEdit = (c: Card) => setDialog({ mode: 'edit', projectId: c.project.id, task: c.task, milestoneTitle: c.milestone.title, relFile: c.milestone.relFile, milestoneId: c.milestone.id });

  const onSave: Parameters<typeof TaskDialog>[0]['onSave'] = async ({ projectId, milestoneId, task, text, status }) => {
    if (!task) return !!(await actions.add(projectId, milestoneId!, text, status));
    if (milestoneId) {
      // One write: status and text change with the move, so the task id is never stale in between.
      return !!(await actions.move(projectId, task, milestoneId, {
        status: status !== task.status ? status : undefined,
        text: text.trim() !== task.text ? text : undefined,
      }));
    }
    // Status first (keeps the id), then text (changes the id).
    if (status !== task.status && !(await actions.setStatus(projectId, task, status))) return false;
    if (text.trim() !== task.text && !(await actions.rename(projectId, task, text))) return false;
    return true;
  };

  const totalTasks = projects.reduce((s, p) => s + p.tasksTotal, 0);

  const suggestionFor = (c: Card) => {
    const s = statusOf(c) === 'todo' ? live.suggestions.get(c.key) : undefined;
    if (!s?.suggestion) return undefined;
    const taskId = s.suggestion.taskId;
    return {
      onAccept: () => { void move(c, 'in_progress'); },
      onDismiss: () => live.dismiss(s.id, taskId),
    };
  };

  return (
    <div className="flex flex-column gap-3">
      <LiveSessions sessions={live.sessions} projectName={multi ? (id) => projects.find((p) => p.id === id)?.name : undefined} />
      <div className="flex flex-wrap gap-2 align-items-center">
        <IconField iconPosition="left" className="flex-grow-1" style={{ minWidth: '12rem' }}>
          <InputIcon className="pi pi-search" />
          <InputText className="w-full" placeholder="Search tasks…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </IconField>
        <MultiSelect value={milestoneFilter} options={milestoneOptions} onChange={(e) => setMilestoneFilter(e.value)}
          placeholder="All milestones" filter showClear maxSelectedLabels={1} selectedItemsLabel="{0} milestones" style={{ minWidth: '14rem' }} />
        <Button label={hideReached ? 'Show reached' : 'Hide reached'} icon={hideReached ? 'pi pi-eye' : 'pi pi-eye-slash'}
          outlined size="small" onClick={() => setHideReached((v) => !v)} />
        <Button label={`Stale only${staleCount ? ` (${staleCount})` : ''}`} icon="pi pi-hourglass" size="small" outlined={!staleOnly}
          aria-pressed={staleOnly} title={`In progress for more than ${staleLimit} days, from git (Settings → Task stale after)`}
          onClick={() => setStaleOnly((v) => !v)} />
      </div>

      {totalTasks === 0 ? (
        <p className="text-500 m-0">No tasks yet. Use + on a column to add the first task under a milestone.</p>
      ) : null}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="grid">
          {COLUMNS.map((col) => {
            const colCards = cards.filter((c) => statusOf(c) === col.status);
            return (
              <Column key={col.status} {...col} cards={colCards.length} onAdd={() => setDialog({ mode: 'add', status: col.status })}>
                {colCards.map((c) => (
                  <TaskCard key={c.key} card={c} showProject={multi} onOpen={() => openEdit(c)} suggestion={suggestionFor(c)}
                    sessions={linked.get(c.key)?.length ?? 0} staleDays={staleDaysOf(c)}
                    onStartClaude={claudeOk && c.project.exists && statusOf(c) === 'todo' ? () => { void startOn(c); } : undefined} />
                ))}
                {!colCards.length && <div className="text-500 text-sm p-3 text-center">Drop tasks here</div>}
              </Column>
            );
          })}
        </div>
        <DragOverlay>{active && <TaskCard card={active} showProject={multi} dragging />}</DragOverlay>
      </DndContext>

      <TaskDialog
        state={dialog}
        projects={projects}
        onHide={() => setDialog(null)}
        onSave={onSave}
        onDelete={async (projectId, task) => !!(await actions.remove(projectId, task))}
        sessionsFor={(projectId, taskId) => linked.get(`${projectId}|${taskId}`) ?? []}
        onStartClaude={claudeOk ? (projectId, task) => {
          const p = projects.find((x) => x.id === projectId);
          if (p) void startClaudeOnTask(p, task);
        } : undefined}
        onResume={claudeOk ? (projectId, s) => { void resumeSession(projectId, s.id, s.title); } : undefined}
      />
    </div>
  );
}
