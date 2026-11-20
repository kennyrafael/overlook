/**
 * Guesses which open plan task a live Claude session is working on, from what the session says
 * (the user's recent prompts, Claude's own step list, the session title).
 *
 * Plan tasks and Claude's steps are worded differently and one session can touch many tasks, so
 * this is a suggestion the user confirms, never a status change on its own. It only answers when
 * one task clearly stands out:
 * - each word of a task is weighted by how rare it is among the project's tasks (IDF), so shared
 *   words like "add" or the project name count for little;
 * - at least MIN_HITS distinct words must match and cover MIN_SCORE of the task's weight;
 * - the best task must beat the runner-up by MIN_MARGIN.
 */

export interface MatchTask { id: string; text: string }
export interface TaskMatch { taskId: string; score: number }

const MIN_SCORE = 0.5;
const MIN_HITS = 2;
const MIN_MARGIN = 0.15;

const STOP = new Set((
  'the a an and or of to in on for with from by at is are be it its as this that these those into via not no '
  + 'add use make show when only one per all new set get run can should will would could also then than so '
  + 'do does done doing let lets please now just like want need see look check sure there their them they you '
  + 'your we our out up off over under more most some any each every other same been was were has have had '
  + 'what which who how why where yes ok okay task tasks step steps file files'
).split(' '));

/** Lower-case words of 3+ letters, light plural stemming; keeps identifiers like `plan-parser`. */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*[a-z0-9]|[a-z0-9]/g) ?? []) {
    let w = raw;
    if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
    else if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.push(w);
  }
  return out;
}

/** `corpus` = every task of the project (for word rarity); `open` = the tasks that may be suggested. */
export function matchTask(sessionText: string, open: MatchTask[], corpus: MatchTask[] = open): TaskMatch | null {
  return taskMatcher(open, corpus)(sessionText);
}

/**
 * The same match with the task side prepared once, for matching many sessions against one project's tasks
 * (word rarity and each task's words are computed up front).
 */
export function taskMatcher(open: MatchTask[], corpus: MatchTask[] = open): (sessionText: string) => TaskMatch | null {
  if (!open.length) return () => null;
  const df = new Map<string, number>();
  for (const t of corpus) for (const w of new Set(words(t.text))) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(corpus.length, 1);
  const idf = (w: string) => Math.log((n + 1) / ((df.get(w) ?? 0) + 1)) + 0.1;
  const prepared = open.map((t) => {
    const ws = [...new Set(words(t.text))].map((w) => ({ w, i: idf(w) }));
    return { taskId: t.id, ws, all: ws.reduce((s, x) => s + x.i, 0) };
  });

  return (sessionText) => {
    const bag = new Set(words(sessionText));
    if (!bag.size) return null;
    const scored = prepared.map((t) => {
      let hit = 0;
      let hits = 0;
      for (const { w, i } of t.ws) if (bag.has(w)) { hit += i; hits++; }
      return { taskId: t.taskId, score: t.all ? hit / t.all : 0, hits };
    }).sort((a, b) => b.score - a.score);

    const [best, next] = scored;
    if (best.hits < MIN_HITS || best.score < MIN_SCORE) return null;
    if (next && best.score - next.score < MIN_MARGIN) return null;
    return { taskId: best.taskId, score: Math.round(best.score * 100) / 100 };
  };
}
