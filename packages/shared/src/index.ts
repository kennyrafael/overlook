export type ProjectStatus = 'active' | 'paused' | 'blocked' | 'done' | 'archived';
export type ProjectSource = 'root' | 'claude' | 'both';
export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Task {
  id: string;
  text: string;
  status: TaskStatus;
  /** Absolute path of the plan file. */
  file: string;
  /** 1-based line of the checkbox. */
  line: number;
  /** Last line of the item (items may wrap onto indented continuation lines). */
  lineEnd: number;
  /** Nesting depth (0 = top-level checkbox). */
  depth: number;
}

export interface Milestone {
  id: string;
  title: string;
  reached: boolean;
  /** Absolute path of the plan file. */
  file: string;
  /** Plan file path relative to the project folder, for display. */
  relFile: string;
  /** Heading level (1–6). */
  level: number;
  /** Titles of enclosing headings, outermost first (e.g. ["To-Do"]). */
  breadcrumb: string[];
  lineStart: number;
  lineEnd: number;
  tasksTotal: number;
  tasksDone: number;
  tasksInProgress: number;
  tasks: Task[];
}

/** One git repository inside a project (the project folder itself or a nested repo). */
export interface RepoStats {
  path: string;
  /** Path relative to the project folder ('' for the project folder itself). */
  relPath: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Changed, staged or untracked files. */
  dirtyFiles: number;
  lastCommitAt: string | null;
  lastCommitSubject: string | null;
  /** Commits on HEAD per local day (YYYY-MM-DD), last 90 days. */
  commitsPerDay: Record<string, number>;
  error?: string;
}

export interface ProjectGit {
  projectId: string;
  name: string;
  repos: RepoStats[];
}

export interface GitOverview {
  generatedAt: string;
  days: number;
  projects: ProjectGit[];
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface ClaudeSession {
  id: string;
  projectId: string | null;
  projectName: string;
  title: string | null;
  startedAt: string;
  endedAt: string;
  /** Prompts typed by the user (tool results excluded). */
  prompts: number;
  /** Model responses (deduplicated by message id). */
  turns: number;
  subagents: number;
  models: string[];
  tokens: TokenUsage;
  costUsd: number;
}

export interface ClaudeDay {
  date: string;
  sessions: number;
  turns: number;
  tokens: TokenUsage;
  costUsd: number;
  costByModel: Record<string, number>;
}

export interface ClaudeOverview {
  generatedAt: string;
  from: string | null;
  to: string | null;
  totals: { sessions: number; prompts: number; turns: number; tokens: TokenUsage; costUsd: number; unpricedTurns: number };
  days: ClaudeDay[];
  byModel: { model: string; turns: number; tokens: TokenUsage; costUsd: number; priced: boolean }[];
  byProject: { projectId: string | null; name: string; sessions: number; turns: number; tokens: TokenUsage; costUsd: number; lastActivityAt: string | null }[];
  sessions: ClaudeSession[];
}

/** USD per million tokens. Cache writes are priced from input × multiplier (5-minute / 1-hour TTL). */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * Estimated list prices (USD / 1M tokens), matched by model-id prefix (longest wins).
 * Editable in Settings; costs are estimates, not invoices.
 */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

export interface Project {
  id: string;
  path: string;
  name: string;
  tags: string[];
  status: ProjectStatus;
  progress: number; // 0..100, milestone-based
  milestonesTotal: number;
  milestonesReached: number;
  tasksTotal: number;
  tasksDone: number;
  /** Plan files that contributed milestones (relative to the project folder). */
  planFiles: string[];
  lastActivityAt: string | null;
  source: ProjectSource;
  pinned: boolean;
  /** False when the folder no longer exists on disk (e.g. only known from Claude history). */
  exists: boolean;
  /** Which markers identified it: .git, CLAUDE.md, .claude, plan files. */
  markers: string[];
  /** Nested repos / worktrees / Claude working dirs folded into this project. */
  subpaths: string[];
  /** Number of Claude Code sessions recorded for this project (incl. subpaths). */
  claudeSessions: number;
  /** True when status was set manually rather than derived. */
  statusOverridden: boolean;
}

/** A project with its full milestone/task breakdown (GET /projects/:id). */
export interface ProjectDetail extends Project {
  milestones: Milestone[];
}

/** Fields the user can change on a project; stored as overrides in SQLite. */
export interface ProjectPatch {
  name?: string | null;
  status?: ProjectStatus | null; // null = back to derived status
  tags?: string[];
  pinned?: boolean;
}

export interface Settings {
  roots: string[];
  ignore: string[];
  planFiles: string[];
  staleDays: number;
  /** How deep to look under each root for project folders. */
  maxDepth: number;
  /** Merge in folders Claude Code has been used in (~/.claude/projects). */
  useClaudeHistory: boolean;
  /** Include the desktop app's per-session scratch workspaces. */
  includeScratch: boolean;
  /** Show projects whose folder no longer exists. */
  includeMissing: boolean;
  theme: 'light' | 'dark';
  /** Per-model prices used for cost estimates (USD / 1M tokens). */
  modelPrices: Record<string, ModelPrice>;
  /** Cache-write price as a multiple of the input price. */
  cacheWrite5mMultiplier: number;
  cacheWrite1hMultiplier: number;
}

export const DEFAULT_SETTINGS: Settings = {
  roots: [],
  ignore: ['node_modules', '.git', 'dist', 'build', '.next', 'coverage'],
  planFiles: ['PLAN.md', 'ROADMAP.md', 'CLAUDE.md', 'TODO.md'],
  staleDays: 14,
  maxDepth: 3,
  useClaudeHistory: true,
  includeScratch: false,
  includeMissing: false,
  theme: 'dark',
  modelPrices: DEFAULT_MODEL_PRICES,
  cacheWrite5mMultiplier: 1.25,
  cacheWrite1hMultiplier: 2,
};

export const PROJECT_STATUSES: ProjectStatus[] = ['active', 'paused', 'blocked', 'done', 'archived'];

export const API_PORT = 4317;

/** Server-sent live update events (GET /api/events). */
export type LiveEvent =
  | { type: 'hello'; at: string }
  | { type: 'project:updated'; projectId: string; file?: string; source: 'external' | 'dashboard' }
  | { type: 'projects:rescanned' }
  | { type: 'git:updated'; projectIds: string[] }
  | { type: 'claude:updated'; projectIds: string[] }
  | { type: 'snapshots:updated' };

/** One day of plan progress (aggregated over the requested projects). */
export interface ProgressPoint {
  date: string;
  milestonesReached: number;
  milestonesTotal: number;
  tasksDone: number;
  tasksTotal: number;
}

export type ProjectAction = 'vscode' | 'terminal' | 'explorer' | 'claude';
export const PROJECT_ACTIONS: ProjectAction[] = ['vscode', 'terminal', 'explorer', 'claude'];

/** Global filter state, as stored in a saved view. */
export interface ViewFilters {
  search: string;
  statuses: ProjectStatus[];
  tags: string[];
  sources: ProjectSource[];
  activity: string[];
  projectIds: string[];
  plannedOnly: boolean;
}

export interface SavedView {
  id: string;
  name: string;
  filters: ViewFilters;
  createdAt: string;
}
