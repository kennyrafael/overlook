import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dropdown } from 'primereact/dropdown';
import { SelectButton } from 'primereact/selectbutton';
import { Button } from 'primereact/button';
import { confirmDialog } from 'primereact/confirmdialog';
import type { ProjectDetail, Task, TaskStatus } from '@overlook/shared';
import { TASK_STATUS_LABEL } from './useTaskActions';

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
}

/** Edit an existing task (text, status, delete) or add a new one under a chosen milestone. */
export default function TaskDialog({ state, projects, onHide, onSave, onDelete }: Props) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [target, setTarget] = useState<string | null>(null); // `${projectId}|${milestoneId}`
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

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
        <div className="flex justify-content-between gap-2">
          <div>{state?.mode === 'edit' && <Button label="Delete" icon="pi pi-trash" severity="danger" text onClick={remove} />}</div>
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
          <small className="text-500">Saved as a single line in the plan file. Ctrl+Enter to save.</small>
        </label>
        <SelectButton value={status} options={STATUS_OPTIONS} onChange={(e) => e.value && setStatus(e.value)} />
      </div>
    </Dialog>
  );
}
