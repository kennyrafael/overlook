import type { ModelPrice, TokenUsage } from '@overlook/shared';
import { localDay } from './limit';

/** Token usage of one model on one local day, split by price class. */
export interface UsageBucket {
  day: string;
  model: string;
  turns: number;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface LogSummary {
  sessionId: string | null;
  title: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Prompts the user typed (excludes tool results and meta/system-injected messages). */
  prompts: number;
  promptDays: Record<string, number>;
  buckets: UsageBucket[];
  /** Format check; see `isUnrecognized`. */
  format: LogFormatStats;
}

/** Counters used to tell "Claude Code changed its log format" from ordinary noise. */
export interface LogFormatStats {
  /** Non-empty lines. */
  lines: number;
  /** Lines that look like JSON records with a string "type". */
  typed: number;
  /** Assistant records, and those with a model and usage we could read. */
  assistant: number;
  assistantUsable: number;
  /** Lines that could not be read (bad JSON in a record we wanted, unexpected shapes). */
  errors: number;
}

/** Bump when LogSummary or its meaning changes, so persisted cache rows are re-parsed. */
export const PARSER_VERSION = 2;

/**
 * True when a log does not look like any Claude Code format we know: most lines are not typed
 * JSON records, most records we wanted could not be read, or there are assistant records but
 * none has usage we can read.
 */
export function isUnrecognized(f: LogFormatStats): boolean {
  if (f.lines === 0) return false;
  if (f.typed / f.lines < 0.5) return true;
  if (f.assistant >= 3 && f.assistantUsable === 0) return true;
  return f.errors / f.lines > 0.5;
}

/**
 * Accumulates a Claude Code session log (.jsonl) line by line.
 * Assistant messages are written once per content block with identical usage,
 * so usage is counted once per message id.
 */
export class LogAccumulator {
  private seen = new Set<string>();
  private buckets = new Map<string, UsageBucket>();
  sessionId: string | null = null;
  title: string | null = null;
  startedAt: number | null = null;
  endedAt: number | null = null;
  prompts = 0;
  promptDays: Record<string, number> = {};
  format: LogFormatStats = { lines: 0, typed: 0, assistant: 0, assistantUsable: 0, errors: 0 };

  /** Never throws: unexpected shapes are counted in `format` and skipped. */
  add(line: string) {
    if (!line.trim()) return;
    this.format.lines++;
    if (/^\s*\{.*"type"\s*:\s*"/.test(line)) this.format.typed++;
    try {
      this.read(line);
    } catch {
      this.format.errors++;
    }
  }

  private read(line: string) {
    // Cheap pre-filter: most lines are tool output we do not need to parse.
    // Tolerates whitespace around ':' in case the writer's JSON style changes.
    const kind = /"type"s*:s*"(assistant|user|summary|custom-title)"/.exec(line)?.[1];
    const isAssistant = kind === 'assistant';
    const isUser = kind === 'user';
    const isTitle = kind === 'summary' || kind === 'custom-title';
    if (!isAssistant && !isUser && !isTitle) return;
    if (isUser && line.includes('"tool_result"')) {
      this.touch(line);
      return;
    }

    let j: any;
    try { j = JSON.parse(line); } catch { this.format.errors++; return; }
    if (!j || typeof j !== 'object') return;

    if (j.type === 'custom-title' && typeof j.customTitle === 'string') { this.title = j.customTitle; return; }
    if (j.type === 'summary' && typeof j.summary === 'string') { this.title ??= j.summary; return; }

    const ts = typeof j.timestamp === 'string' ? Date.parse(j.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      this.startedAt = this.startedAt === null ? ts : Math.min(this.startedAt, ts);
      this.endedAt = this.endedAt === null ? ts : Math.max(this.endedAt, ts);
    }
    this.sessionId ??= typeof j.sessionId === 'string' ? j.sessionId : null;

    if (j.type === 'user') {
      if (j.isMeta || j.isSidechain || Number.isNaN(ts)) return;
      const c = j.message?.content;
      const typed = typeof c === 'string'
        ? !c.startsWith('<command-') && !c.startsWith('<local-command')
        : Array.isArray(c) && c.some((b: any) => b?.type === 'text') && !c.some((b: any) => b?.type === 'tool_result');
      if (typed) {
        this.prompts++;
        const day = localDay(new Date(ts));
        this.promptDays[day] = (this.promptDays[day] ?? 0) + 1;
      }
      return;
    }

    if (j.type === 'assistant') {
      this.format.assistant++;
      const msg = j.message;
      const u = msg?.usage;
      const model: unknown = msg?.model;
      if (model === '<synthetic>') { this.format.assistantUsable++; return; }
      if (!u || typeof u !== 'object' || typeof model !== 'string' || !model || Number.isNaN(ts)) return;
      this.format.assistantUsable++;
      const id: unknown = msg.id ?? j.requestId ?? j.uuid;
      if (typeof id === 'string' && id) {
        if (this.seen.has(id)) return;
        this.seen.add(id);
      }
      const day = localDay(new Date(ts));
      const key = `${day}|${model}`;
      const b = this.buckets.get(key) ?? { day, model, turns: 0, input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
      const cw = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
      const cw1h = Number(cw?.ephemeral_1h_input_tokens ?? 0);
      const cw5m = cw ? Number(cw.ephemeral_5m_input_tokens ?? 0) : Number(u.cache_creation_input_tokens ?? 0);
      b.turns += 1;
      b.input += tokens(u.input_tokens);
      b.output += tokens(u.output_tokens);
      b.cacheWrite5m += tokens(cw5m);
      b.cacheWrite1h += tokens(cw1h);
      b.cacheRead += tokens(u.cache_read_input_tokens);
      this.buckets.set(key, b);
    }
  }

  /** Track time range from lines we skip parsing fully. */
  private touch(line: string) {
    const m = /"timestamp":"([^"]+)"/.exec(line);
    if (!m) return;
    const ts = Date.parse(m[1]);
    if (Number.isNaN(ts)) return;
    this.startedAt = this.startedAt === null ? ts : Math.min(this.startedAt, ts);
    this.endedAt = this.endedAt === null ? ts : Math.max(this.endedAt, ts);
  }

  summary(): LogSummary {
    return {
      sessionId: this.sessionId, title: this.title, startedAt: this.startedAt, endedAt: this.endedAt,
      prompts: this.prompts, promptDays: this.promptDays, buckets: [...this.buckets.values()],
      format: { ...this.format },
    };
  }
}

/** Token counts from the log: anything that is not a finite, non-negative number counts as 0. */
function tokens(x: unknown): number {
  const n = Number(x ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface PriceTable {
  prices: Record<string, ModelPrice>;
  cacheWrite5mMultiplier: number;
  cacheWrite1hMultiplier: number;
}

/** Longest configured prefix of the model id wins (e.g. "claude-opus-5-5" before "claude-opus-5"). */
export function priceFor(model: string, table: PriceTable): ModelPrice | null {
  const id = model.toLowerCase();
  let best: string | null = null;
  for (const key of Object.keys(table.prices)) {
    if (id.startsWith(key.toLowerCase()) && (!best || key.length > best.length)) best = key;
  }
  return best ? table.prices[best] : null;
}

export function bucketCost(b: UsageBucket, table: PriceTable): number | null {
  const p = priceFor(b.model, table);
  if (!p) return null;
  return (
    b.input * p.input
    + b.output * p.output
    + b.cacheWrite5m * p.input * table.cacheWrite5mMultiplier
    + b.cacheWrite1h * p.input * table.cacheWrite1hMultiplier
    + b.cacheRead * p.cacheRead
  ) / 1_000_000;
}

export function bucketTokens(b: UsageBucket): TokenUsage {
  return { input: b.input, output: b.output, cacheWrite: b.cacheWrite5m + b.cacheWrite1h, cacheRead: b.cacheRead };
}

export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead };
}

export const ZERO_TOKENS: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
