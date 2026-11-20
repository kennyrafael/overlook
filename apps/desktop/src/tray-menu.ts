/**
 * The dynamic part of the tray / menu-bar menu: live Claude sessions, recent projects and "Start Claude in…".
 * Pure functions (no Electron import), so the menu and the API requests behind it are unit-tested.
 */
import type { MenuItemConstructorOptions } from 'electron';

const PROJECT_ID_RE = /^[0-9a-f]{12}$/;
export const RECENT_COUNT = 5;

/** What the main process reads from its own API (GET /api/insights/live and GET /api/projects). */
export interface TrayData {
  live: { id: string; projectId: string; title: string | null; state: 'working' | 'idle'; waiting: boolean }[];
  projects: { id: string; name: string; lastActivityAt: string | null; pinned: boolean; exists: boolean }[];
}

export interface TrayActions {
  openProject(projectId: string): void;
  startClaude(projectId: string): void;
}

/**
 * A request to the app's own server. It carries the per-launch token cookie (the server refuses any other
 * caller) and the client header that mutations need. Only fixed API paths are built here.
 */
export function apiRequest(origin: string, token: string, path: string, method: 'GET' | 'POST' = 'GET'): { url: string; init: RequestInit } {
  if (!path.startsWith('/api/')) throw new Error(`Not an API path: ${path}`);
  const headers: Record<string, string> = { 'x-cpd-client': '1', Cookie: `cpd_token=${token}` };
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  return { url: origin + path, init: { method, headers, ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(5000) } };
}

/** POST /api/projects/:id/actions/claude for a checked project id (anything else is refused before a request). */
export function startClaudePath(projectId: string): string {
  if (!PROJECT_ID_RE.test(projectId)) throw new Error('Invalid project id');
  return `/api/projects/${projectId}/actions/claude`;
}

/** Menu label text: one line, bounded, and (on Windows/Linux) `&` kept literal instead of becoming a mnemonic. */
export function label(s: string, max = 60, platform: string = process.platform): string {
  const one = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = one.length > max ? `${one.slice(0, max - 1)}…` : one;
  return platform === 'darwin' ? cut : cut.replace(/&/g, '&&');
}

/** "alpha: Fix the parser — working" / "— waiting" / "— idle". */
export function liveLabel(s: TrayData['live'][number], projectName: string, platform: string = process.platform): string {
  const state = s.state === 'working' ? 'working' : s.waiting ? 'waiting' : 'idle';
  return label(`${projectName}: ${s.title || 'Untitled session'} — ${state}`, 70, platform);
}

/** Projects that exist on disk, by last activity (newest first), at most `n`. */
export function recentProjects(projects: TrayData['projects'], n = RECENT_COUNT): TrayData['projects'] {
  return projects
    .filter((p) => p.exists && PROJECT_ID_RE.test(p.id))
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') || a.name.localeCompare(b.name))
    .slice(0, n);
}

/** For "Start Claude in…": pinned projects first, then by last activity. */
export function topProjects(projects: TrayData['projects'], n = RECENT_COUNT): TrayData['projects'] {
  return recentProjects(projects, Infinity).sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, n);
}

/** The items between "Open Overlook" and "Check for updates". Empty data gives no items (the menu stays usable). */
export function dynamicItems(data: TrayData, actions: TrayActions, platform: string = process.platform): MenuItemConstructorOptions[] {
  const names = new Map(data.projects.map((p) => [p.id, p.name]));
  const items: MenuItemConstructorOptions[] = [];

  const live = data.live.filter((s) => PROJECT_ID_RE.test(s.projectId)).slice(0, 8);
  if (live.length) {
    items.push({ type: 'separator' }, { label: 'Live sessions', enabled: false });
    for (const s of live) {
      items.push({ label: liveLabel(s, names.get(s.projectId) ?? 'Project', platform), click: () => actions.openProject(s.projectId) });
    }
  }

  const recent = recentProjects(data.projects);
  if (recent.length) {
    items.push({ type: 'separator' }, { label: 'Recent projects', enabled: false });
    for (const p of recent) items.push({ label: label(p.name, 60, platform), click: () => actions.openProject(p.id) });
  }

  const top = topProjects(data.projects);
  if (top.length) {
    items.push({ type: 'separator' }, {
      label: 'Start Claude in…',
      submenu: top.map((p) => ({ label: label(p.name, 60, platform), click: () => actions.startClaude(p.id) })),
    });
  }
  return items;
}

/** Event types on GET /api/events after which the tray menu is rebuilt. */
export const TRAY_EVENTS = new Set(['claude:updated', 'projects:rescanned', 'project:updated']);

/** Event names in a chunk of a Server-Sent Events stream (`event: <name>` lines). */
export function sseEventNames(chunk: string): string[] {
  return [...chunk.matchAll(/^event: *([\w:-]+) *$/gm)].map((m) => m[1]);
}
