import type { LiveStep, TaskStatus } from '@overlook/shared';

/** Most recent typed prompts kept for task matching. */
const KEEP_PROMPTS = 3;
const MAX_PROMPT_CHARS = 2000;

/**
 * Follows one Claude Code session log (.jsonl) to tell what Claude is doing right now: the task
 * list it keeps for itself (the desktop app's plan tool, TodoWrite, or TaskCreate/TaskUpdate),
 * the user's latest prompts, and whether the turn has ended.
 *
 * Fed line by line, so a live log can be read incrementally from the last offset.
 * Never throws: lines it does not understand are skipped.
 */
export class LiveAccumulator {
  sessionId: string | null = null;
  title: string | null = null;
  lastAt: number | null = null;
  /** True after the assistant ended its turn and before the next prompt. */
  waiting = false;
  steps: InternalStep[] = [];
  prompts: string[] = [];
  /** TaskCreate tool_use id → index in `steps`, until its result tells us the task id. */
  private createdBy = new Map<string, number>();
  /** Task id (from TaskCreate results) → index in `steps`. */
  private taskIds = new Map<string, number>();

  add(line: string) {
    if (!line.trim()) return;
    // Cheap pre-filter: skip records we never need (tool output is most of a log).
    const kind = /"type"\s*:\s*"(assistant|user|summary|custom-title)"/.exec(line)?.[1];
    if (!kind) return;
    let j: any;
    try { j = JSON.parse(line); } catch { return; }
    if (!j || typeof j !== 'object') return;
    try { this.read(j); } catch { /* unexpected shape */ }
  }

  private read(j: any) {
    if (j.type === 'custom-title' && typeof j.customTitle === 'string') { this.title = j.customTitle; return; }
    if (j.type === 'summary' && typeof j.summary === 'string') { this.title ??= j.summary; return; }
    if (j.type !== 'user' && j.type !== 'assistant') return;
    if (j.isSidechain) return;
    this.sessionId ??= typeof j.sessionId === 'string' ? j.sessionId : null;
    const ts = typeof j.timestamp === 'string' ? Date.parse(j.timestamp) : NaN;
    if (!Number.isNaN(ts)) this.lastAt = Math.max(this.lastAt ?? ts, ts);
    const content = j.message?.content;

    if (j.type === 'user') {
      if (Array.isArray(content)) {
        for (const b of content) if (b?.type === 'tool_result') this.onToolResult(b);
      }
      if (j.isMeta) return;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content) && !content.some((b: any) => b?.type === 'tool_result')
          ? content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n')
          : '';
      if (!text.trim() || text.startsWith('<command-') || text.startsWith('<local-command')) return;
      this.waiting = false;
      this.prompts.push(text.slice(0, MAX_PROMPT_CHARS));
      if (this.prompts.length > KEEP_PROMPTS) this.prompts.shift();
      return;
    }

    // assistant (stop reason first: a wrap-up tool call ends the turn even though it stops on tool_use)
    const stop = j.message?.stop_reason;
    if (stop === 'end_turn' || stop === 'stop_sequence') this.waiting = true;
    else if (stop === 'tool_use') this.waiting = false;
    if (Array.isArray(content)) {
      for (const b of content) if (b?.type === 'tool_use' && b.input && typeof b.input === 'object') this.onToolUse(b.name, b.input, b.id);
    }
  }

  private onToolUse(name: unknown, input: any, id: unknown) {
    if (typeof name !== 'string') return;
    // Desktop app plan tool: whole list, or advance / done / start deltas (1-based).
    if (/(^|__)update_plan$/.test(name)) {
      if (Array.isArray(input.items)) {
        this.steps = input.items.map((it: any) => step(it?.content, it?.status)).filter(isStep);
      }
      if (input.advance === true) {
        const cur = this.steps.findIndex((s) => s.status === 'in_progress');
        if (cur >= 0) this.steps[cur].status = 'done';
        const next = this.steps.findIndex((s, i) => i > cur && s.status === 'todo');
        if (next >= 0) this.steps[next].status = 'in_progress';
      }
      if (Array.isArray(input.done)) {
        for (const n of input.done) if (this.steps[n - 1]) this.steps[n - 1].status = 'done';
      }
      if (typeof input.start === 'number' && this.steps[input.start - 1]) {
        for (const s of this.steps) if (s.status === 'in_progress') s.status = 'todo';
        this.steps[input.start - 1].status = 'in_progress';
      }
      return;
    }
    if (/(^|__)wrap_up$/.test(name)) {
      this.waiting = true;
      for (const s of this.steps) if (s.status === 'in_progress') s.status = 'done';
      return;
    }
    if (name === 'TodoWrite' && Array.isArray(input.todos)) {
      this.steps = input.todos.map((t: any) => step(t?.content, t?.status)).filter(isStep);
      this.taskIds.clear();
      return;
    }
    if (name === 'TaskCreate') {
      const s = step(input.subject ?? input.content, input.status ?? 'pending');
      if (!s) return;
      this.steps.push(s);
      if (typeof id === 'string') this.createdBy.set(id, this.steps.length - 1);
      return;
    }
    if (name === 'TaskUpdate') {
      const idx = this.taskIds.get(String(input.taskId ?? input.id));
      if (idx === undefined || !this.steps[idx]) return;
      if (input.status === 'deleted') { this.steps[idx].status = 'done'; this.steps[idx].deleted = true; return; }
      const st = statusOf(input.status);
      if (st) this.steps[idx].status = st;
      if (typeof input.subject === 'string' && input.subject.trim()) this.steps[idx].text = input.subject.trim();
    }
  }

  /** TaskCreate answers with the new task's id ("Task #3 created …"). */
  private onToolResult(b: any) {
    const idx = typeof b.tool_use_id === 'string' ? this.createdBy.get(b.tool_use_id) : undefined;
    if (idx === undefined) return;
    this.createdBy.delete(b.tool_use_id);
    const text = typeof b.content === 'string'
      ? b.content
      : Array.isArray(b.content) ? b.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join(' ') : '';
    const m = /#\s*([\w-]+)/.exec(text) ?? /\bid\W+([\w-]+)/i.exec(text);
    // Fallback: Claude Code numbers tasks 1, 2, 3… within a session.
    this.taskIds.set(m ? m[1] : String(this.taskIds.size + 1), idx);
  }

  /** The visible list (deleted TaskCreate tasks dropped). */
  visibleSteps(): LiveStep[] {
    return this.steps.filter((s) => !s.deleted).map(({ text, status }) => ({ text, status }));
  }
}

type InternalStep = LiveStep & { deleted?: boolean };

function statusOf(s: unknown): TaskStatus | null {
  if (s === 'in_progress') return 'in_progress';
  if (s === 'completed' || s === 'done') return 'done';
  if (s === 'pending' || s === 'todo') return 'todo';
  return null;
}

function step(text: unknown, status: unknown): InternalStep | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  return { text: text.trim(), status: statusOf(status) ?? 'todo' };
}

const isStep = (s: InternalStep | null): s is InternalStep => !!s;
