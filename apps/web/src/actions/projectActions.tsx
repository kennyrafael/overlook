import { useEffect, useRef } from 'react';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import { SplitButton } from 'primereact/splitbutton';
import type { MenuItem } from 'primereact/menuitem';
import type { Project, ProjectAction } from '@overlook/shared';
import { api } from '../api';
import { appToast } from '../toast';
import { actionAvailable, useTools } from '../store/tools';

export const ACTION_META: Record<ProjectAction, { label: string; icon: string; done: string }> = {
  vscode: { label: 'Open in VS Code', icon: 'pi pi-code', done: 'Opening VS Code' },
  terminal: { label: 'Open terminal', icon: 'pi pi-desktop', done: 'Opening a terminal' },
  explorer: { label: 'Show in Explorer', icon: 'pi pi-folder-open', done: 'Opening the folder' },
  claude: { label: 'Start Claude Code', icon: 'pi pi-microchip-ai', done: 'Starting Claude Code' },
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

/** Actions that can run on this machine (VS Code hidden when not installed, etc.). */
export function useAvailableActions(): ProjectAction[] {
  const tools = useTools((s) => s.tools);
  useEffect(() => { void useTools.getState().load(); }, []);
  return ORDER.filter((a) => actionAvailable(tools, a));
}

const items = (project: Pick<Project, 'id' | 'name' | 'exists'>, actions: ProjectAction[], skip?: ProjectAction): MenuItem[] =>
  actions.filter((a) => a !== skip).map((a) => ({
    label: ACTION_META[a].label, icon: ACTION_META[a].icon, command: () => runProjectAction(project, a),
  }));

/** Header control: the first available action (usually "Open in VS Code") with the rest in the dropdown. */
export function ProjectActionsButton({ project }: { project: Project }) {
  const actions = useAvailableActions();
  const primary = actions[0] ?? 'explorer';
  return (
    <SplitButton
      label={ACTION_META[primary].label}
      icon={ACTION_META[primary].icon}
      onClick={() => runProjectAction(project, primary)}
      model={items(project, actions, primary)}
      disabled={!project.exists}
      size="small"
      outlined
    />
  );
}

/** Compact row control: one icon that opens a menu of actions. */
export function ProjectActionsMenu({ project }: { project: Project }) {
  const menu = useRef<Menu>(null);
  const actions = useAvailableActions();
  return (
    <>
      <Menu model={items(project, actions)} popup ref={menu} />
      <Button icon="pi pi-external-link" rounded text aria-label={`Open ${project.name}`} disabled={!project.exists}
        onClick={(e) => menu.current?.toggle(e)} />
    </>
  );
}
