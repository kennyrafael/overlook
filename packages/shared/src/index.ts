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
  /** False when no git executable was found; projects is then empty. */
  gitAvailable: boolean;
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
  /** The plan task this session most likely worked on (matched from its title and prompts), if one stands out. */
  task: { id: string; text: string } | null;
  /** Can be continued with `claude --resume` on this machine (a local log; WSL sessions cannot). */
  resumable: boolean;
}

/** A recent session that worked on a plan task (GET /api/insights/task-sessions). */
export interface TaskSessionRef {
  id: string;
  title: string | null;
  endedAt: string;
  resumable: boolean;
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
  /** Session logs read, and those that do not look like any Claude Code format we know. */
  logFormat: { files: number; unrecognizedFiles: number; examples: string[] };
  /** Tool calls and errors in the range, for the selected projects (incl. subagents), most-used first. */
  byTool: ClaudeToolCount[];
  /** Tool calls and errors in the range over all projects, to compare the selection with. */
  toolsOverall: { calls: number; errors: number };
  /** Usage in the last 5 hours and the last 7 days over all projects, whatever the range (estimates from local logs). */
  rolling: ClaudeUsageWindow[];
}

/** One item of the task list Claude keeps for itself during a session. */
export interface LiveStep {
  text: string;
  status: TaskStatus;
}

/**
 * A Claude Code session with recent activity (GET /api/insights/live), read from its log.
 * `suggestion` is a guess at the open plan task the session is on; it is shown for the user to
 * confirm and never changes the plan file by itself.
 */
export interface LiveSession {
  id: string;
  projectId: string;
  title: string | null;
  lastActivityAt: string;
  /** working = mid-turn; idle = the turn ended or the log went quiet. */
  state: 'working' | 'idle';
  /** Claude ended its turn and is waiting for the user (not just quiet mid-turn). */
  waiting: boolean;
  steps: LiveStep[];
  /** The step Claude marked in progress, if any. */
  current: string | null;
  suggestion: { taskId: string; text: string; score: number } | null;
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
  /** Also read Claude Code history inside running WSL distros (Windows only). */
  useWsl: boolean;
  /** The first-run setup has been completed or skipped. */
  onboarded: boolean;
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
  /** First prompt for "Start Claude on this task": {task} is the task text, {milestone} and {file} say where it is. */
  claudeTaskPrompt: string;
}

export const DEFAULT_CLAUDE_TASK_PROMPT = 'Work on this task from {file} ({milestone}): {task}';

export const DEFAULT_SETTINGS: Settings = {
  roots: [],
  ignore: ['node_modules', '.git', 'dist', 'build', '.next', 'coverage'],
  planFiles: ['PLAN.md', 'ROADMAP.md', 'CLAUDE.md', 'TODO.md'],
  staleDays: 14,
  maxDepth: 3,
  useClaudeHistory: true,
  useWsl: true,
  onboarded: false,
  includeScratch: false,
  includeMissing: false,
  theme: 'dark',
  modelPrices: DEFAULT_MODEL_PRICES,
  cacheWrite5mMultiplier: 1.25,
  cacheWrite1hMultiplier: 2,
  claudeTaskPrompt: DEFAULT_CLAUDE_TASK_PROMPT,
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

/** Local tools the quick actions and onboarding rely on (detected on the server's machine). */
export interface SystemTools {
  platform: string;
  git: boolean;
  /** Claude Code CLI (`claude`) on PATH. */
  claude: boolean;
  vscode: boolean;
  /**
   * What "Open terminal" will use: Windows Terminal / Command Prompt, Terminal / iTerm, or on Linux the
   * detected terminal (GNOME Terminal, Konsole, …, or "terminal emulator" for x-terminal-emulator).
   */
  terminal: string | null;
  /** "Show in folder" can work (always on Windows and macOS; on Linux when xdg-open is installed). */
  openFolder: boolean;
  /** Running WSL distros where Claude Code history was found. */
  wslClaude: string[];
  /** Where Claude Code history is read from (local folder plus any WSL folders). */
  claudeHistory: { label: string; dir: string }[];
}

export type ProjectAction = 'vscode' | 'terminal' | 'explorer' | 'claude';
export const PROJECT_ACTIONS: ProjectAction[] = ['vscode', 'terminal', 'explorer', 'claude'];

/**
 * Optional body of POST /api/projects/:id/actions/claude: start Claude on a plan task (the server builds the
 * prompt from the task and Settings → claudeTaskPrompt), or resume one of the project's sessions.
 */
export interface ClaudeActionBody {
  taskId?: string;
  resume?: string;
}

export interface ActionResult {
  ok: true;
  action: ProjectAction;
  /**
   * Set when a task prompt was asked for. False when the prompt cannot be handed over safely on this machine
   * (a claude.cmd wrapper, the cmd.exe fallback, a generic x-terminal-emulator): Claude starts without it and
   * the UI copies `prompt` to the clipboard.
   */
  promptPassed?: boolean;
  prompt?: string;
}

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

/** One kind of network request the app can make. Shown in Settings → Network activity. */
export interface NetworkCall {
  what: string;
  destination: string;
  when: string;
  sends: string;
  /** False for calls planned in a later version. */
  active: boolean;
}

/**
 * Every outbound call the app can make. Project data, plans and Claude logs are never sent.
 * Keep this list complete: the privacy promise depends on it.
 */
export const NETWORK_CALLS: NetworkCall[] = [
  {
    what: 'Update check',
    destination: 'overlook-downloads.kennyrafael-cg.workers.dev (Overlook release feed and installer download)',
    when: 'At start-up and once a day, Windows desktop app only; off with Settings → Desktop app → Check for updates automatically',
    sends: 'Nothing beyond a normal download request (IP address, user agent with the app version). The download server counts the request anonymously (platform, version, country); no IP address or user agent is stored',
    active: true,
  },
  {
    what: 'Feedback',
    destination: 'overlook-feedback.kennyrafael-cg.workers.dev (AgentHub feedback inbox)',
    when: 'Only when you press Send in the Feedback dialog; never automatically',
    sends: 'Only the answers you give in the form, the app version and your email if you add one. No project data, paths or usage; the IP address is not stored',
    active: true,
  },
];

export * from './feedback';

export interface SystemInfo {
  dataDir: string;
  logDir: string;
  network: NetworkCall[];
}

/** About dialog: version, license and the bundled third-party notices. */
export interface AboutInfo {
  version: string;
  license: string;
  notices: string;
}

/** Settings → Export: everything the user configured, as JSON. */
export interface AppDataExport {
  app: 'overlook';
  format: 1;
  exportedAt: string;
  settings: Settings;
  projectOverrides: { id: string; name: string | null; status: string | null; tags: string[]; pinned: boolean }[];
  views: { id: string; name: string; filters: ViewFilters; createdAt: string }[];
}

// Phase 7: time and tokens

/** Calls of one tool; `errors` are its results Claude Code marked as errors. */
export interface ClaudeToolCount {
  tool: string;
  calls: number;
  errors: number;
}

/**
 * Usage in a window that ends now (`hours` long, at hour resolution: hours that overlap the window count
 * whole). An estimate from local logs at list prices, not a plan's limit.
 */
export interface ClaudeUsageWindow {
  key: '5h' | '7d';
  hours: number;
  /** Start of the oldest hour counted. */
  from: string;
  turns: number;
  tokens: TokenUsage;
  costUsd: number;
  unpricedTurns: number;
  byModel: { model: string; turns: number; tokens: TokenUsage; costUsd: number; priced: boolean }[];
}

/** GET /api/insights/sessions/:id — one session read from its log on demand. */
export interface ClaudeSessionDetail {
  id: string;
  title: string | null;
  projectId: string | null;
  projectName: string;
  /** Where Claude Code ran (the log's first cwd). */
  cwd: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  resumable: boolean;
  subagents: number;
  models: string[];
  task: { id: string; text: string } | null;
  /** Main log plus subagents. */
  totals: { prompts: number; turns: number; tokens: TokenUsage; costUsd: number; unpricedTurns: number; subagentCostUsd: number };
  /** Typed prompts in order, cut to about 500 characters. */
  prompts: { at: string; text: string; truncated: boolean }[];
  /** Prompts not listed because the session has very many. */
  promptsOmitted: number;
  /** Claude's work after each prompt (main log): `prompt` indexes `prompts`, -1 for replies before the first one. */
  perPrompt: { prompt: number; at: string; turns: number; tokens: TokenUsage; costUsd: number }[];
  /** Incl. subagents, most-used first. */
  tools: ClaudeToolCount[];
  /** Files Claude changed (Edit, Write, MultiEdit, NotebookEdit; incl. subagents), relative to the project when inside it. */
  edited: { path: string; edits: number }[];
}

/** GET /api/insights/search — a session whose title or typed prompts match. */
export interface ClaudeSearchHit {
  id: string;
  title: string | null;
  projectId: string | null;
  projectName: string;
  endedAt: string;
  /** Where the best match is. */
  matchedIn: 'title' | 'prompt';
  /** When the matching prompt was typed (the session start for a title match). */
  at: string;
  /** Text around the match; matched words are between \u0002 and \u0003. */
  snippet: string;
  resumable: boolean;
}

/** GET /api/insights/milestone-costs — estimated Claude cost of the sessions matched to each milestone's tasks. */
export interface ClaudeMilestoneCosts {
  milestones: { id: string; title: string; reached: boolean; sessions: number; turns: number; tokens: TokenUsage; costUsd: number }[];
  /** Sessions of the project that matched no task (or a task in no milestone). */
  unmatched: { sessions: number; costUsd: number };
}
