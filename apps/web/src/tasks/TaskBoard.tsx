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

function TaskCard({ card, showProject, dragging, onOpen, suggestion }: {
  card: Card; showProject: boolean; dragging?: boolean; onOpen?: () => void;
  suggestion?: { onAccept: () => void; onDismiss: () => void };
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.key, data: card });
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
        <Tag value={card.milestone.title} severity="secondary" className="board-milestone-tag" />
      </div>
      <div className={`board-card-text ${card.task.status === 'done' ? 'line-through text-500' : ''}`}>{card.task.text}</div>
      <small className="text-500 block mt-2">{card.milestone.relFile}:{card.task.line}</small>
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
  const [active, setActive] = useState<Card | null>(null);
  const [pending, setPending] = useState<Record<string, TaskStatus>>({});
  const [dialog, setDialog] = useState<TaskDialogState>(null);
  // On a conflict the open task is stale: close the dialog and reload.
  const handleConflict = useCallback(() => { setDialog(null); onConflict?.(); }, [onConflict]);
  const actions = useTaskActions(onProjectChanged, handleConflict);
  const multi = projects.length > 1;
  const live = useLiveSessions(projects.map((p) => p.id));

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
          out.push({ key: `${project.id}|${task.id}`, project, milestone, task });
        }
      }
    }
    return out;
  }, [projects, milestoneFilter, query, hideReached]);

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

  const openEdit = (c: Card) => setDialog({ mode: 'edit', projectId: c.project.id, task: c.task, milestoneTitle: c.milestone.title, relFile: c.milestone.relFile });

  const onSave: Parameters<typeof TaskDialog>[0]['onSave'] = async ({ projectId, milestoneId, task, text, status }) => {
    if (!task) return !!(await actions.add(projectId, milestoneId!, text, status));
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
                {colCards.map((c) => <TaskCard key={c.key} card={c} showProject={multi} onOpen={() => openEdit(c)} suggestion={suggestionFor(c)} />)}
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
      />
    </div>
  );
}
