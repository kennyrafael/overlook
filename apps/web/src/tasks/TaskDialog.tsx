import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dropdown } from 'primereact/dropdown';
import { SelectButton } from 'primereact/selectbutton';
import { Button } from 'primereact/button';
import { confirmDialog } from 'primereact/confirmdialog';
import type { ProjectDetail, Task, TaskSessionRef, TaskStatus } from '@overlook/shared';
import { TASK_STATUS_LABEL } from './useTaskActions';
import { MOD } from '../platform';
import { relativeTime } from '../format';

const STATUS_OPTIONS = (['todo', 'in_progress', 'done'] as TaskStatus[]).map((s) => ({ label: TASK_STATUS_LABEL[s], value: s }));

export type TaskDialogState =
  | { mode: 'edit'; projectId: string; task: Task; milestoneTitle: string; relFile: string }
  | { mode: 'add'; status: TaskStatus; projectId?: string; milestoneId?: string }
  | null;

interface Props {
  state: TaskDialogState;
  projects: ProjectDetail[];
  onHide: () => void;
  onSave: (args: { projectId: string; milestoneId?: string; task?: Task; text: string; status: TaskStatus }) => Promise<boolean>;
  onDelete: (projectId: string, task: Task) => Promise<boolean>;
  /** Recent Claude sessions that worked on a task. */
  sessionsFor?: (projectId: string, taskId: string) => TaskSessionRef[];
  /** Present when Claude Code can be started on this machine. */
  onStartClaude?: (projectId: string, task: Task) => void;
  onResume?: (projectId: string, session: TaskSessionRef) => void;
}

/** Edit an existing task (text, status, delete) or add a new one under a chosen milestone. */
export default function TaskDialog({ state, projects, onHide, onSave, onDelete, sessionsFor, onStartClaude, onResume }: Props) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [target, setTarget] = useState<string | null>(null); // `${projectId}|${milestoneId}`
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const linked = state?.mode === 'edit' && sessionsFor ? sessionsFor(state.projectId, state.task.id) : [];

  useEffect(() => {
    if (!state) return;
    if (state.mode === 'edit') {
      setText(state.task.text);
      setStatus(state.task.status);
    } else {
      setText('');
      setStatus(state.status);
      const firstOpen = projects.flatMap((p) => p.milestones.filter((m) => !m.reached).map((m) => `${p.id}|${m.id}`))[0];
      setTarget(state.projectId && state.milestoneId ? `${state.projectId}|${state.milestoneId}` : firstOpen ?? null);
    }
  }, [state, projects]);

  const milestoneOptions = projects.map((p) => ({
    label: p.name,
    items: p.milestones.map((m) => ({
      label: `${m.reached ? '✓ ' : ''}${m.title}`,
      value: `${p.id}|${m.id}`,
    })),
  })).filter((g) => g.items.length);

  const save = async () => {
    if (!state || !text.trim()) return;
    setBusy(true);
    try {
      let ok: boolean;
      if (state.mode === 'edit') {
        ok = await onSave({ projectId: state.projectId, task: state.task, text, status });
      } else {
        if (!target) return;
        const [projectId, milestoneId] = target.split('|');
        ok = await onSave({ projectId, milestoneId, text, status });
      }
      if (ok) onHide();
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (state?.mode !== 'edit') return;
    confirmDialog({
      header: 'Delete task?',
      message: `This removes the line from ${state.relFile}. A backup of the file is kept.`,
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: async () => { if (await onDelete(state.projectId, state.task)) onHide(); },
    });
  };

  return (
    <Dialog
      header={state?.mode === 'edit' ? 'Edit task' : 'Add task'}
      visible={!!state}
      onHide={onHide}
      onShow={() => textRef.current?.focus()}
      style={{ width: 'min(36rem, 95vw)' }}
      footer={
        <div className="task-dialog-footer flex flex-wrap justify-content-between gap-2">
          <div className="flex gap-2">
            {state?.mode === 'edit' && <Button label="Delete" icon="pi pi-trash" severity="danger" text onClick={remove} />}
            {state?.mode === 'edit' && onStartClaude && state.task.status !== 'done' && (
              <Button label="Start Claude" icon="pi pi-play" outlined title="Open Claude Code at the project with this task as the first prompt"
                onClick={() => { onStartClaude(state.projectId, state.task); onHide(); }} />
            )}
          </div>
          <div className="flex gap-2">
            <Button label="Cancel" text onClick={onHide} />
            <Button label="Save" icon="pi pi-check" loading={busy} disabled={!text.trim() || (state?.mode === 'add' && !target)} onClick={save} />
          </div>
        </div>
      }
    >
      <div className="flex flex-column gap-3">
        {state?.mode === 'edit' ? (
          <small className="text-500">{state.milestoneTitle} · {state.relFile}:{state.task.line}</small>
        ) : (
          <label className="flex flex-column gap-2">
            <span>Milestone</span>
            <Dropdown value={target} options={milestoneOptions} optionGroupLabel="label" optionGroupChildren="items"
              onChange={(e) => setTarget(e.value)} placeholder="Choose a milestone" filter />
          </label>
        )}
        <label className="flex flex-column gap-2">
          <span>Task</span>
          <InputTextarea ref={textRef} value={text} onChange={(e) => setText(e.target.value)} autoResize rows={3}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }} />
          <small className="text-500">Saved as a single line in the plan file. {MOD}+Enter to save.</small>
        </label>
        <SelectButton value={status} options={STATUS_OPTIONS} onChange={(e) => e.value && setStatus(e.value)} />
        {linked.length > 0 && (
          <div className="flex flex-column gap-1" aria-label="Claude sessions on this task">
            <span>Claude sessions on this task</span>
            {linked.map((s) => (
              <div key={s.id} className="flex align-items-center gap-2 text-sm">
                <i className="pi pi-comments text-500" />
                <span className="white-space-nowrap overflow-hidden text-overflow-ellipsis" title={s.title ?? s.id}>{s.title ?? <em className="text-500">untitled</em>}</span>
                <small className="text-500 white-space-nowrap">{relativeTime(s.endedAt)}</small>
                {onResume && s.resumable && state?.mode === 'edit' && (
                  <Button label="Resume" icon="pi pi-replay" text size="small" className="ml-auto py-1"
                    onClick={() => { onResume(state.projectId, s); onHide(); }} />
                )}
              </div>
            ))}
            <small className="text-500">Matched from the sessions' titles and prompts; a guess, not a record.</small>
          </div>
        )}
      </div>
    </Dialog>
  );
}
