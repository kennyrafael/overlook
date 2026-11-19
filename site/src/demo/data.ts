// Made-up projects shared by the landing page demos and the screenshot script (scripts/shots.ts), so
// what visitors play with matches what the screenshots show. No real people, products or repos.
// Days are counted back from "today" (0 = today), so the data always looks current.

export const DAYS = 90;

export type TaskState = 'todo' | 'doing' | 'done';

export interface DemoTask {
  text: string;
  /** Days ago the task was ticked. Unset = not done. */
  doneDay?: number;
  /** Marked `[~]` (in progress) today. */
  doing?: boolean;
}

export interface DemoMilestone {
  title: string;
  tasks: DemoTask[];
}

export interface DemoProject {
  name: string;
  tagline: string;
  tags: string[];
  /** Plan file name inside the project. */
  planFile: 'PLAN.md' | 'ROADMAP.md';
  milestones: DemoMilestone[];
  /** Average commits per active day. */
  commitRate: number;
  /** Chance (0..1) that a given day has commits while the project is active. */
  activeChance: number;
  /** No commits or sessions after this many days ago (0 = still active). */
  quietSince: number;
  /** Share of Claude Code usage (weights, normalised over all projects). */
  claudeWeight: number;
  /** Working-tree state today. */
  uncommitted: string[];
  unpushed: number;
}

export const PROJECTS: DemoProject[] = [
  {
    name: 'trailmap',
    tagline: 'Offline trail maps for hikers',
    tags: ['web', 'maps'],
    planFile: 'PLAN.md',
    commitRate: 3.2,
    activeChance: 0.8,
    quietSince: 0,
    claudeWeight: 5,
    uncommitted: ['src/offline/packs.ts', 'src/offline/packs.test.ts'],
    unpushed: 2,
    milestones: [
      {
        title: 'Phase 1: Map tiles',
        tasks: [
          { text: 'Vector tile renderer', doneDay: 84 },
          { text: 'Elevation shading', doneDay: 79 },
          { text: 'Trail search by name', doneDay: 71 },
          { text: 'GPX import', doneDay: 66 },
        ],
      },
      {
        title: 'Phase 2: Offline packs',
        tasks: [
          { text: 'Pick an area and download it', doneDay: 41 },
          { text: 'Storage quota warnings', doneDay: 30 },
          { text: 'Background updates for saved packs', doneDay: 9 },
          { text: 'Resume interrupted downloads', doing: true },
          { text: 'Delete packs from settings' },
        ],
      },
      {
        title: 'Phase 3: Sharing',
        tasks: [
          { text: 'Share a route as a link' },
          { text: 'Export to PDF for printing' },
          { text: 'Group hikes with live positions' },
        ],
      },
    ],
  },
  {
    name: 'tidepool-api',
    tagline: 'Booking API for a surf school',
    tags: ['api', 'client'],
    planFile: 'ROADMAP.md',
    commitRate: 2.4,
    activeChance: 0.65,
    quietSince: 0,
    claudeWeight: 4,
    uncommitted: [],
    unpushed: 0,
    milestones: [
      {
        title: 'Milestone 1: Bookings',
        tasks: [
          { text: 'Lessons, instructors and time slots', doneDay: 62 },
          { text: 'Booking with seat limits', doneDay: 55 },
          { text: 'Cancellation rules', doneDay: 47 },
        ],
      },
      {
        title: 'Milestone 2: Payments',
        tasks: [
          { text: 'Card payments in test mode', doneDay: 33 },
          { text: 'Refunds for cancelled lessons', doneDay: 18 },
          { text: 'Gift vouchers', doneDay: 4 },
          { text: 'Invoices by email', doing: true },
        ],
      },
      {
        title: 'Milestone 3: Weather',
        tasks: [
          { text: 'Swell forecast per beach' },
          { text: 'Auto-reschedule on storm warnings' },
        ],
      },
    ],
  },
  {
    name: 'inkwell',
    tagline: 'Markdown notes with backlinks',
    tags: ['desktop', 'notes'],
    planFile: 'PLAN.md',
    commitRate: 1.8,
    activeChance: 0.5,
    quietSince: 2,
    claudeWeight: 2.5,
    uncommitted: ['docs/shortcuts.md'],
    unpushed: 0,
    milestones: [
      {
        title: 'Editor',
        tasks: [
          { text: 'Live preview', doneDay: 88 },
          { text: 'Wiki links with autocomplete', doneDay: 75 },
          { text: 'Backlinks panel', doneDay: 58 },
        ],
      },
      {
        title: 'Search',
        tasks: [
          { text: 'Full-text index', doneDay: 39 },
          { text: 'Tag filters', doneDay: 27 },
          { text: 'Search inside code blocks', doneDay: 12 },
        ],
      },
      {
        title: 'Release 1.0',
        tasks: [
          { text: 'Keyboard shortcut sheet', doneDay: 3 },
          { text: 'Installer and auto-update', doing: true },
        ],
      },
    ],
  },
  {
    name: 'pocket-ledger',
    tagline: 'Shared budgets for flatmates',
    tags: ['mobile'],
    planFile: 'PLAN.md',
    commitRate: 1.5,
    activeChance: 0.45,
    quietSince: 23,
    claudeWeight: 1.5,
    uncommitted: [],
    unpushed: 1,
    milestones: [
      {
        title: 'Phase 1: Splits',
        tasks: [
          { text: 'Add an expense and split it', doneDay: 80 },
          { text: 'Who owes whom', doneDay: 64 },
        ],
      },
      {
        title: 'Phase 2: Monthly view',
        tasks: [
          { text: 'Category totals', doneDay: 36 },
          { text: 'Recurring bills', doneDay: 25 },
          { text: 'Export to CSV' },
          { text: 'Reminders before rent day' },
        ],
      },
    ],
  },
  {
    name: 'lumen-cli',
    tagline: 'Batch photo renamer',
    tags: ['cli'],
    planFile: 'PLAN.md',
    commitRate: 1.2,
    activeChance: 0.35,
    quietSince: 15,
    claudeWeight: 1,
    uncommitted: [],
    unpushed: 0,
    milestones: [
      {
        title: 'Core',
        tasks: [
          { text: 'Read EXIF dates', doneDay: 86 },
          { text: 'Rename patterns', doneDay: 77 },
          { text: 'Dry run with a preview table', doneDay: 52 },
        ],
      },
      {
        title: 'Release',
        tasks: [
          { text: 'Homebrew and winget packages', doneDay: 21 },
          { text: 'Man page', doneDay: 16 },
        ],
      },
    ],
  },
];

/** Deterministic pseudo-random numbers (mulberry32), so demos and screenshots never change between runs. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

/** State of a task as of `daysAgo` days ago. */
export function taskState(t: DemoTask, daysAgo = 0): TaskState {
  if (t.doneDay !== undefined && t.doneDay >= daysAgo) return 'done';
  return t.doing && daysAgo === 0 ? 'doing' : 'todo';
}

const MARK: Record<TaskState, string> = { todo: ' ', doing: '~', done: 'x' };

/** The project's plan file as it read `daysAgo` days ago (format from README "Plan file format"). */
export function planMarkdown(p: DemoProject, daysAgo = 0): string {
  const lines = [`# ${p.name}`, '', p.tagline + '.', ''];
  for (const m of p.milestones) {
    lines.push(`## ${m.title}`);
    for (const t of m.tasks) lines.push(`- [${MARK[taskState(t, daysAgo)]}] ${t.text}`);
    lines.push('');
  }
  return lines.join('\n');
}

export interface Progress { done: number; total: number; milestonesReached: number; milestones: number }

export function progress(p: DemoProject, daysAgo = 0): Progress {
  const tasks = p.milestones.flatMap((m) => m.tasks);
  return {
    done: tasks.filter((t) => taskState(t, daysAgo) === 'done').length,
    total: tasks.length,
    milestonesReached: p.milestones.filter((m) => m.tasks.every((t) => taskState(t, daysAgo) === 'done')).length,
    milestones: p.milestones.length,
  };
}

/** Commits per day, oldest first: index 0 is DAYS-1 days ago, the last entry is today. */
export function commitsByDay(p: DemoProject): number[] {
  const rand = rng(seedOf(p.name));
  const doneDays = new Set(p.milestones.flatMap((m) => m.tasks.map((t) => t.doneDay)).filter((d) => d !== undefined));
  const out: number[] = [];
  for (let ago = DAYS - 1; ago >= 0; ago--) {
    const weekend = ((new Date().getDay() - ago) % 7 + 7) % 7 % 6 === 0;
    const active = ago >= p.quietSince && rand() < p.activeChance * (weekend ? 0.45 : 1);
    let n = active ? Math.max(1, Math.round(p.commitRate * (0.4 + rand() * 1.2))) : 0;
    if (doneDays.has(ago)) n = Math.max(n, 1); // ticking a task is a commit
    out.push(n);
  }
  return out;
}

export const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export type DemoModel = (typeof MODELS)[number];

export interface DemoSession {
  project: string;
  daysAgo: number;
  hour: number;
  title: string;
  prompts: string[];
  /** Assistant turns: model and token usage. */
  turns: { model: DemoModel; input: number; output: number; cacheRead: number; cacheWrite: number }[];
}

const PROMPTS = [
  'Write tests for the parser edge cases',
  'Why does this fail on Windows paths?',
  'Refactor the store so the view only re-renders on change',
  'Add a migration for the new column',
  'Review this diff before I commit',
  'Make the empty state friendlier',
  'Find where the slow query comes from',
  'Tick the plan items we finished today',
];

/** Claude Code sessions over the last DAYS days, following each project's activity. */
export function sessions(): DemoSession[] {
  const out: DemoSession[] = [];
  for (const p of PROJECTS) {
    const rand = rng(seedOf(p.name + ':claude'));
    const commits = commitsByDay(p);
    commits.forEach((n, i) => {
      const daysAgo = DAYS - 1 - i;
      if (daysAgo < p.quietSince || (!n && rand() > 0.15)) return;
      const count = Math.max(1, Math.round((n / 2) * (0.5 + rand()) * (p.claudeWeight / 3)));
      for (let s = 0; s < count; s++) {
        const turns = Array.from({ length: 3 + Math.floor(rand() * 9) }, () => {
          const r = rand();
          const model: DemoModel = r < 0.55 ? 'claude-opus-5-5' : r < 0.9 ? 'claude-sonnet-5-5' : 'claude-haiku-5-5';
          return {
            model,
            input: 400 + Math.floor(rand() * 3000),
            output: 600 + Math.floor(rand() * 5000),
            cacheRead: 8000 + Math.floor(rand() * 60000),
            cacheWrite: 500 + Math.floor(rand() * 6000),
          };
        });
        const prompts = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => PROMPTS[Math.floor(rand() * PROMPTS.length)]);
        out.push({ project: p.name, daysAgo, hour: 9 + Math.floor(rand() * 10), title: prompts[0], prompts, turns });
      }
    });
  }
  return out;
}
