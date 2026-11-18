import { useCallback } from 'react';
import { Button } from 'primereact/button';
import type { ProjectDetail, Task, TaskStatus } from '@overlook/shared';
import { api, ApiError } from '../api';
import { appToast } from '../toast';
import { useProjects } from '../store/projects';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

/**
 * Task edits that write to plan files. Each returns the updated project (or null on failure),
 * shows feedback, offers Undo for status changes, and keeps the project list in sync.
 */
export function useTaskActions(onChanged: (p: ProjectDetail) => void, onConflict?: () => void) {
  const refreshList = useProjects((s) => s.load);

  const run = useCallback(async (fn: () => Promise<ProjectDetail>, success?: string): Promise<ProjectDetail | null> => {
    try {
      const p = await fn();
      onChanged(p);
      refreshList();
      if (success) appToast.current?.show({ severity: 'success', summary: success, life: 2500 });
      return p;
    } catch (e) {
      const conflict = e instanceof ApiError && e.status === 409;
      appToast.current?.show({
        severity: conflict ? 'warn' : 'error',
        summary: conflict ? 'Plan file changed' : 'Could not save',
        detail: e instanceof Error ? e.message : String(e),
        life: 5000,
      });
      if (conflict) onConflict?.();
      return null;
    }
  }, [onChanged, onConflict, refreshList]);

  const setStatus = useCallback(async (projectId: string, task: Task, status: TaskStatus) => {
    if (task.status === status) return null;
    const p = await run(() => api.updateTask(projectId, task.id, { status }));
    if (p) {
      const previous = task.status;
      appToast.current?.show({
        severity: 'success',
        life: 5000,
        content: () => (
          <div className="flex align-items-center gap-3 w-full">
            <i className="pi pi-check-circle text-xl" />
            <div className="flex-grow-1">
              <div className="font-semibold">Moved to {TASK_STATUS_LABEL[status]}</div>
              <small className="line-height-2" style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.text}</small>
            </div>
            <Button label="Undo" size="small" text onClick={() => {
              appToast.current?.clear();
              // Status edits keep the task id, so the same id can be reverted.
              run(() => api.updateTask(projectId, task.id, { status: previous }), 'Change undone');
            }} />
          </div>
        ),
      });
    }
    return p;
  }, [run]);

  const rename = useCallback((projectId: string, task: Task, text: string) =>
    run(() => api.updateTask(projectId, task.id, { text }), 'Task updated'), [run]);

  const add = useCallback((projectId: string, milestoneId: string, text: string, status: TaskStatus) =>
    run(() => api.addTask(projectId, milestoneId, text, status), 'Task added'), [run]);

  const remove = useCallback((projectId: string, task: Task) =>
    run(() => api.deleteTask(projectId, task.id), 'Task deleted'), [run]);

  return { setStatus, rename, add, remove };
}
