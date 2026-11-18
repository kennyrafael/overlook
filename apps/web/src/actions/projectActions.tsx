import { useRef } from 'react';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import { SplitButton } from 'primereact/splitbutton';
import type { MenuItem } from 'primereact/menuitem';
import type { Project, ProjectAction } from '@overlook/shared';
import { api } from '../api';
import { appToast } from '../toast';

export const ACTION_META: Record<ProjectAction, { label: string; icon: string; done: string }> = {
  vscode: { label: 'Open in VS Code', icon: 'pi pi-code', done: 'Opening VS Code' },
  terminal: { label: 'Open terminal', icon: 'pi pi-desktop', done: 'Opening a terminal' },
  explorer: { label: 'Show in Explorer', icon: 'pi pi-folder-open', done: 'Opening the folder' },
  claude: { label: 'Start Claude Code', icon: 'pi pi-sparkles', done: 'Starting Claude Code' },
};

const ORDER: ProjectAction[] = ['vscode', 'claude', 'terminal', 'explorer'];

export async function runProjectAction(project: Pick<Project, 'id' | 'name' | 'exists'>, action: ProjectAction) {
  if (!project.exists) {
    appToast.current?.show({ severity: 'warn', summary: 'Folder not found', detail: `${project.name} no longer exists on disk` });
    return;
  }
  try {
    await api.runAction(project.id, action);
    appToast.current?.show({ severity: 'info', summary: ACTION_META[action].done, detail: project.name, life: 2000 });
  } catch (e) {
    appToast.current?.show({ severity: 'error', summary: `${ACTION_META[action].label} failed`, detail: e instanceof Error ? e.message : String(e) });
  }
}

const items = (project: Pick<Project, 'id' | 'name' | 'exists'>, skip?: ProjectAction): MenuItem[] =>
  ORDER.filter((a) => a !== skip).map((a) => ({
    label: ACTION_META[a].label, icon: ACTION_META[a].icon, command: () => runProjectAction(project, a),
  }));

/** Header control: primary "Open in VS Code" with the other actions in the dropdown. */
export function ProjectActionsButton({ project }: { project: Project }) {
  return (
    <SplitButton
      label={ACTION_META.vscode.label}
      icon={ACTION_META.vscode.icon}
      onClick={() => runProjectAction(project, 'vscode')}
      model={items(project, 'vscode')}
      disabled={!project.exists}
      size="small"
      outlined
    />
  );
}

/** Compact row control: one icon that opens a menu of actions. */
export function ProjectActionsMenu({ project }: { project: Project }) {
  const menu = useRef<Menu>(null);
  return (
    <>
      <Menu model={items(project)} popup ref={menu} />
      <Button icon="pi pi-external-link" rounded text aria-label={`Open ${project.name}`} disabled={!project.exists}
        onClick={(e) => menu.current?.toggle(e)} />
    </>
  );
}
