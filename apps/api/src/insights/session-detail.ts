import { LogAccumulator, type LogSummary, type UsageCounts } from './session-log';

/** Prompt text kept for the session detail page. */
export const DETAIL_PROMPT_CHARS = 500;
/** At most this many prompts are listed; the count of the rest is reported. */
export const DETAIL_MAX_PROMPTS = 2000;
/** Prompt text kept for the search index. */
export const INDEX_PROMPT_CHARS = 2000;
export const INDEX_MAX_PROMPTS = 2000;
/** Distinct edited files listed per session. */
const DETAIL_MAX_FILES = 1000;

/** Tools that change files, and the input field that names the file. */
const EDIT_TOOLS: Record<string, string[]> = {
  Edit: ['file_path'],
  Write: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path', 'file_path'],
};

export interface DetailPrompt { at: number; text: string; truncated: boolean }

/** Usage of one model while Claude answered one prompt. */
export interface ExchangeUsage extends UsageCounts { model: string; turns: number }

/** Everything Claude did between one typed prompt and the next. `prompt` is -1 before the first prompt. */
export interface Exchange { prompt: number; at: number; usage: ExchangeUsage[] }

export interface EditedFile { path: string; edits: number }

/** Raw session detail of one log file, before pricing and project paths are applied. */
export interface ParsedDetail {
  summary: LogSummary;
  prompts: DetailPrompt[];
  promptsOmitted: number;
  exchanges: Exchange[];
  edited: EditedFile[];
}

const clip = (text: string, n: number) => {
  const t = text.trim();
  return t.length > n ? { text: t.slice(0, n).trimEnd() + '…', truncated: true } : { text: t, truncated: false };
};

/** Collects the detail of one session log on top of the ordinary summary (one pass, one JSON parse per line). */
export class DetailAccumulator {
  private acc: LogAccumulator;
  private prompts: DetailPrompt[] = [];
  private promptCount = 0;
  private exchanges: Exchange[] = [];
  private edited = new Map<string, EditedFile>();
  private editUses = new Map<string, EditedFile>();

  constructor() {
    this.acc = new LogAccumulator({
      prompt: (at, text) => {
        this.promptCount++;
        if (this.prompts.length < DETAIL_MAX_PROMPTS) this.prompts.push({ at, ...clip(text, DETAIL_PROMPT_CHARS) });
        this.exchanges.push({ prompt: this.promptCount - 1, at, usage: [] });
      },
      reply: (at, model, u) => {
        let ex = this.exchanges.at(-1);
        if (!ex) { ex = { prompt: -1, at, usage: [] }; this.exchanges.push(ex); }
        let m = ex.usage.find((x) => x.model === model);
        if (!m) { m = { model, turns: 0, input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }; ex.usage.push(m); }
        m.turns++;
        m.input += u.input;
        m.output += u.output;
        m.cacheWrite5m += u.cacheWrite5m;
        m.cacheWrite1h += u.cacheWrite1h;
        m.cacheRead += u.cacheRead;
      },
      toolUse: (_at, name, input, useId) => {
        const fields = EDIT_TOOLS[name];
        if (!fields || !input || typeof input !== 'object') return;
        const path = fields.map((f) => (input as Record<string, unknown>)[f]).find((v): v is string => typeof v === 'string' && v.length > 0);
        if (!path) return;
        let e = this.edited.get(path);
        if (!e) {
          if (this.edited.size >= DETAIL_MAX_FILES) return;
          e = { path, edits: 0 };
          this.edited.set(path, e);
        }
        e.edits++;
        if (useId) this.editUses.set(useId, e);
      },
      // A failed edit (e.g. "string not found") changed nothing.
      toolError: (useId) => {
        const e = this.editUses.get(useId);
        if (e) e.edits--;
      },
    });
  }

  add(line: string) { this.acc.add(line); }

  result(): ParsedDetail {
    return {
      summary: this.acc.summary(),
      prompts: this.prompts,
      promptsOmitted: this.promptCount - this.prompts.length,
      // Prompts Claude never answered (e.g. interrupted at once) still show in the prompt list.
      exchanges: this.exchanges.filter((e) => e.usage.length),
      edited: [...this.edited.values()].filter((e) => e.edits > 0),
    };
  }
}

/** A prompt as stored in the search index. */
export interface IndexedPrompt { at: number; text: string }

/** Collects typed prompts for the search index next to the summary. */
export function indexAccumulator() {
  const prompts: IndexedPrompt[] = [];
  const acc = new LogAccumulator({
    prompt: (at, text) => {
      const t = text.replace(/\s+/g, ' ').trim().slice(0, INDEX_PROMPT_CHARS);
      if (t && prompts.length < INDEX_MAX_PROMPTS) prompts.push({ at, text: t });
    },
  });
  return { add: (line: string) => acc.add(line), result: () => ({ summary: acc.summary(), prompts }) };
}

/**
 * `p` relative to `base` when it lies inside it (either slash, case-insensitive on Windows-style paths),
 * else `p` unchanged.
 */
export function relativeInside(base: string | null | undefined, p: string): string {
  if (!base) return p;
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const b = norm(base);
  const q = norm(p);
  const fold = /^[a-zA-Z]:/.test(b) || b.startsWith('//');
  const [bb, qq] = fold ? [b.toLowerCase(), q.toLowerCase()] : [b, q];
  if (qq === bb) return '.';
  return qq.startsWith(bb + '/') ? q.slice(b.length + 1) : p;
}
