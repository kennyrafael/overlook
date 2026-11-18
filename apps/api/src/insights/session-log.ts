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

  add(line: string) {
    // Cheap pre-filter: most lines are tool output we do not need to parse.
    const isAssistant = line.includes('"type":"assistant"');
    const isUser = !isAssistant && line.includes('"type":"user"');
    const isTitle = !isAssistant && !isUser && (line.includes('"custom-title"') || line.includes('"type":"summary"'));
    if (!isAssistant && !isUser && !isTitle) return;
    if (isUser && line.includes('"tool_result"')) {
      this.touch(line);
      return;
    }

    let j: any;
    try { j = JSON.parse(line); } catch { return; }

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
      const msg = j.message;
      const u = msg?.usage;
      const model: string | undefined = msg?.model;
      if (!u || !model || model === '<synthetic>' || Number.isNaN(ts)) return;
      const id: string = msg.id ?? j.requestId ?? j.uuid;
      if (id) {
        if (this.seen.has(id)) return;
        this.seen.add(id);
      }
      const day = localDay(new Date(ts));
      const key = `${day}|${model}`;
      const b = this.buckets.get(key) ?? { day, model, turns: 0, input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
      const cw = u.cache_creation;
      const cw1h = Number(cw?.ephemeral_1h_input_tokens ?? 0);
      const cw5m = cw ? Number(cw.ephemeral_5m_input_tokens ?? 0) : Number(u.cache_creation_input_tokens ?? 0);
      b.turns += 1;
      b.input += Number(u.input_tokens ?? 0);
      b.output += Number(u.output_tokens ?? 0);
      b.cacheWrite5m += cw5m;
      b.cacheWrite1h += cw1h;
      b.cacheRead += Number(u.cache_read_input_tokens ?? 0);
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
    };
  }
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
