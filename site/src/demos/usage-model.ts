// Claude Code usage for the demo (pure): cost per day and model from the made-up sessions, priced like
// the app does it (DEFAULT_MODEL_PRICES in packages/shared, USD per million tokens; 5-minute cache
// writes cost 1.25 × input). Estimates at API list prices, not a bill.
import { DAYS, MODELS, sessions, type DemoModel, type DemoSession } from '../demo/data.ts';

export const PRICES: Record<DemoModel, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const MODEL_LABEL: Record<DemoModel, string> = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };

type Turn = DemoSession['turns'][number];

export const turnCost = (t: Turn) => {
  const p = PRICES[t.model];
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.input * CACHE_WRITE_MULTIPLIER) / 1e6;
};

export interface UsageDay {
  daysAgo: number;
  cost: Record<DemoModel, number>;
  total: number;
  outputTokens: number;
  sessions: number;
}

export interface UsageFilter {
  days: number;
  project?: string;
  models?: ReadonlySet<DemoModel>;
}

export interface UsageSummary {
  days: UsageDay[];
  sessions: number;
  prompts: number;
  outputTokens: number;
  cost: number;
  byProject: { project: string; cost: number }[];
}

let cache: DemoSession[] | null = null;
const all = () => (cache ??= sessions());

/** Days oldest first (index 0 = `days - 1` days ago). */
export function summarize(f: UsageFilter, list: DemoSession[] = all()): UsageSummary {
  const days = Math.min(DAYS, Math.max(1, f.days));
  const models = f.models ?? new Set(MODELS);
  const out: UsageDay[] = Array.from({ length: days }, (_, i) => ({
    daysAgo: days - 1 - i,
    cost: Object.fromEntries(MODELS.map((m) => [m, 0])) as Record<DemoModel, number>,
    total: 0,
    outputTokens: 0,
    sessions: 0,
  }));
  const byProject = new Map<string, number>();
  let prompts = 0, count = 0;
  for (const s of list) {
    if (s.daysAgo >= days || (f.project && s.project !== f.project)) continue;
    const day = out[days - 1 - s.daysAgo];
    let used = false;
    for (const t of s.turns) {
      if (!models.has(t.model)) continue;
      const c = turnCost(t);
      day.cost[t.model] += c;
      day.total += c;
      day.outputTokens += t.output;
      byProject.set(s.project, (byProject.get(s.project) ?? 0) + c);
      used = true;
    }
    if (used) { day.sessions++; count++; prompts += s.prompts.length; }
  }
  return {
    days: out,
    sessions: count,
    prompts,
    outputTokens: out.reduce((a, d) => a + d.outputTokens, 0),
    cost: out.reduce((a, d) => a + d.total, 0),
    byProject: [...byProject].map(([project, cost]) => ({ project, cost })).sort((a, b) => b.cost - a.cost),
  };
}

export const usd = (n: number) => `US$${n.toFixed(2)}`;
export const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
