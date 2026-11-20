import type { ActionResult, ClaudeActionBody, TaskSessionRef, LiveSession,ClaudeOverview, GitOverview, Project, ProjectAction, ProjectDetail, ProjectPatch, SavedView, Settings, TaskStatus, ViewFilters, SystemTools, SystemInfo, AppDataExport, AboutInfo, FeedbackInput } from '@overlook/shared';
import type { PlanTemplate, PlanTemplateId, StaleTask } from '@overlook/shared';

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
  // Phase 6: plans you can trust
  /** Moves a task (with its sub-tasks) to the end of another milestone of the project; status/text may change in the same write. */
  moveTask: (projectId: string, taskId: string, patch: { milestoneId: string; status?: TaskStatus; text?: string }) =>
    request<ProjectDetail>(`/projects/${projectId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  staleTasks: () => request<StaleTask[]>('/plans/stale'),
  planTemplates: (projectId: string) => request<PlanTemplate[]>(`/projects/${projectId}/plan-templates`),
  /** Writes the chosen starter plan into the project folder; only after the user confirms the preview. */
  createPlanFile: (projectId: string, template: PlanTemplateId) =>
    request<ProjectDetail>(`/projects/${projectId}/plan-file`, { method: 'POST', body: JSON.stringify({ template }) }),
};
