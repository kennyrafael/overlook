import { useEffect, useRef } from 'react';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import { SplitButton } from 'primereact/splitbutton';
import type { MenuItem } from 'primereact/menuitem';
import type { Project, ProjectAction } from '@overlook/shared';
import { api } from '../api';
import { appToast } from '../toast';
import { actionAvailable, useTools } from '../store/tools';
import { isLinux, isMac } from '../platform';

export const ACTION_META: Record<ProjectAction, { label: string; icon: string; done: string }> = {
  vscode: { label: 'Open in VS Code', icon: 'pi pi-code', done: 'Opening VS Code' },
  terminal: { label: 'Open terminal', icon: 'pi pi-desktop', done: 'Opening a terminal' },
  explorer: { label: isMac ? 'Show in Finder' : isLinux ? 'Show in folder' : 'Show in Explorer', icon: 'pi pi-folder-open', done: 'Opening the folder' },
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

/** Copies text; false when the clipboard is not available (an http page in some browsers, a denied permission). */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

const failed = (summary: string, e: unknown) =>
  appToast.current?.show({ severity: 'error', summary, detail: e instanceof Error ? e.message : String(e) });

/**
 * "Start Claude on this task": opens Claude Code at the project with a prompt the server builds from the task
 * (Settings → Claude task prompt). Where the prompt cannot be passed safely, Claude starts without it and the
 * prompt goes to the clipboard.
 */
export async function startClaudeOnTask(project: { id: string; name: string }, task: { id: string; text: string }) {
  try {
    const r = await api.runAction(project.id, 'claude', { taskId: task.id });
    if (r.promptPassed === false && r.prompt) {
      const copied = await copyText(r.prompt);
      appToast.current?.show({
        severity: 'info', life: 6000, summary: 'Starting Claude Code',
        detail: copied ? 'The task prompt is on your clipboard: paste it into Claude.' : `Paste this into Claude: ${r.prompt}`,
      });
    } else {
      appToast.current?.show({ severity: 'info', summary: 'Starting Claude on this task', detail: task.text, life: 2500 });
    }
  } catch (e) {
    failed('Could not start Claude', e);
  }
}

/** "Resume session": `claude --resume <id>` in the folder the session ran in. */
export async function resumeSession(projectId: string, sessionId: string, label?: string | null) {
  try {
    await api.runAction(projectId, 'claude', { resume: sessionId });
    appToast.current?.show({ severity: 'info', summary: 'Resuming the session', detail: label ?? undefined, life: 2500 });
  } catch (e) {
    failed('Could not resume the session', e);
  }
}

/**
 * "Open in Claude app": the desktop app cannot resume a CLI session by id, so this starts a new desktop session in
 * the folder the session ran in, with a prompt pointing at the old transcript. The app asks to confirm the folder.
 */
export async function resumeInDesktopApp(projectId: string, sessionId: string) {
  try {
    await api.runAction(projectId, 'claude', { resume: sessionId, desktop: true });
    appToast.current?.show({ severity: 'info', summary: 'Opening the Claude app', detail: 'Confirm the folder there; the prompt is filled in, not sent.', life: 5000 });
  } catch (e) {
    failed('Could not open the Claude app', e);
  }
}

/** Claude Code and a terminal are installed (or not known yet), so the Claude actions can be offered. */
export function useClaudeAvailable(): boolean {
  const tools = useTools((s) => s.tools);
  useEffect(() => { void useTools.getState().load(); }, []);
  return actionAvailable(tools, 'claude');
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
  const primary = actions[0];
  if (!primary) return null; // no tool for any action on this machine (e.g. Linux without a terminal or xdg-open)
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
  if (!actions.length) return null;
  return (
    <>
      <Menu model={items(project, actions)} popup ref={menu} />
      <Button icon="pi pi-external-link" rounded text aria-label={`Open ${project.name}`} disabled={!project.exists}
        onClick={(e) => menu.current?.toggle(e)} />
    </>
  );
}
