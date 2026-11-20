import type { ActionResult, ClaudeActionBody, TaskSessionRef, LiveSession,ClaudeOverview, GitOverview, Project, ProjectAction, ProjectDetail, ProjectPatch, SavedView, Settings, TaskStatus, ViewFilters, SystemTools, SystemInfo, AppDataExport, AboutInfo, FeedbackInput } from '@overlook/shared';
import type { ClaudeMilestoneCosts, ClaudeSearchHit, ClaudeSessionDetail } from '@overlook/shared';
import type { AwaySummary, RepoBranches, WorkSummary } from '@overlook/shared';

export class ApiError extends Error {
  /** Field errors from a 400 answer (feedback form), keyed by field name. */
  constructor(message: string, public status: number, public errors?: Record<string, string>) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    // The custom header lets the server reject cross-site requests (see local-only middleware).
    headers: { 'Content-Type': 'application/json', 'x-cpd-client': '1', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(typeof body?.message === 'string' ? body.message : `${res.status} ${res.statusText}`, res.status, body?.errors);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; time: string }>('/health'),
  projects: () => request<Project[]>('/projects'),
  project: (id: string) => request<ProjectDetail>(`/projects/${id}`),
  rescan: () => request<Project[]>('/projects/rescan', { method: 'POST' }),
  updateProject: (id: string, patch: ProjectPatch) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  updateTask: (projectId: string, taskId: string, patch: { status?: TaskStatus; text?: string }) =>
    request<ProjectDetail>(`/projects/${projectId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addTask: (projectId: string, milestoneId: string, text: string, status: TaskStatus) =>
    request<ProjectDetail>(`/projects/${projectId}/milestones/${milestoneId}/tasks`, { method: 'POST', body: JSON.stringify({ text, status }) }),
  deleteTask: (projectId: string, taskId: string) =>
    request<ProjectDetail>(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }),
  git: (projectIds?: string[], refresh = false) => {
    const q = new URLSearchParams();
    if (projectIds) q.set('projects', projectIds.join(','));
    if (refresh) q.set('refresh', '1');
    return request<GitOverview>(`/insights/git?${q}`);
  },
  claude: (range: { from?: string; to?: string }, projectIds?: string[]) => {
    const q = new URLSearchParams();
    if (range.from) q.set('from', range.from);
    if (range.to) q.set('to', range.to);
    if (projectIds) q.set('projects', projectIds.join(','));
    return request<ClaudeOverview>(`/insights/claude?${q}`);
  },
  live: (projectIds?: string[]) =>
    request<LiveSession[]>(`/insights/live${projectIds ? `?projects=${encodeURIComponent(projectIds.join(','))}` : ''}`),
  runAction: (projectId: string, action: ProjectAction, body?: ClaudeActionBody) =>
    request<ActionResult>(`/projects/${projectId}/actions/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  taskSessions: (projectId: string) =>
    request<Record<string, TaskSessionRef[]>>(`/insights/task-sessions?project=${encodeURIComponent(projectId)}`),
  views: () => request<SavedView[]>('/views'),
  createView: (name: string, filters: ViewFilters) =>
    request<SavedView>('/views', { method: 'POST', body: JSON.stringify({ name, filters }) }),
  updateView: (id: string, patch: { name?: string; filters?: ViewFilters }) =>
    request<SavedView>(`/views/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteView: (id: string) => request<{ ok: true }>(`/views/${id}`, { method: 'DELETE' }),
  tools: () => request<SystemTools>('/system/tools'),
  systemInfo: () => request<SystemInfo>('/system/info'),
  about: () => request<AboutInfo>('/system/about'),
  openLogs: () => request<{ ok: true }>('/system/open-logs', { method: 'POST' }),
  exportData: () => request<AppDataExport>('/system/export'),
  importData: (data: unknown) =>
    request<{ settings: number; projectOverrides: number; views: number }>('/system/import', { method: 'POST', body: JSON.stringify(data) }),
  resetData: () => request<{ ok: true }>('/system/reset', { method: 'POST', body: JSON.stringify({ confirm: 'reset' }) }),
  /** Sends one feedback form to AgentHub (through the local server; only when the user presses Send). */
  sendFeedback: (body: FeedbackInput) => request<{ ok: true }>('/feedback', { method: 'POST', body: JSON.stringify(body) }),
  settings: () => request<Settings>('/settings'),
  saveSettings: (s: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(s) }),
  claudeSession: (id: string) => request<ClaudeSessionDetail>(`/insights/sessions/${encodeURIComponent(id)}`),
  searchClaude: (q: string, projectIds?: string[]) => {
    const p = new URLSearchParams({ q });
    if (projectIds) p.set('projects', projectIds.join(','));
    return request<ClaudeSearchHit[]>(`/insights/search?${p}`);
  },
  milestoneCosts: (projectId: string) =>
    request<ClaudeMilestoneCosts>(`/insights/milestone-costs?project=${encodeURIComponent(projectId)}`),
  // Phase 8: daily overview
  away: (device: string) => request<AwaySummary>(`/insights/away?device=${encodeURIComponent(device)}`),
  markSeen: (device: string) =>
    request<{ lastSeenAt: string }>('/insights/away/seen', { method: 'POST', body: JSON.stringify({ device }) }),
  summary: (from: string, to: string) =>
    request<WorkSummary>(`/insights/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  gitBranches: (projectId: string, repo: string) =>
    request<RepoBranches>(`/insights/git/branches?project=${encodeURIComponent(projectId)}&repo=${encodeURIComponent(repo)}`),
};
