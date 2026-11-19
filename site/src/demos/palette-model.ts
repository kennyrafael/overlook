// Command palette matching (pure): every query character must appear in order. Exact substrings,
// word starts and consecutive letters score higher. Returns null when it does not match.
const BOUNDARY = /[\s:/._-]/;

function greedy(q: string, t: string, from: number): number | null {
  let score = 0, ti = from, prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    score += 1;
    if (at === prev + 1) score += 3;
    if (at === 0 || BOUNDARY.test(t[at - 1])) score += 4;
    score -= Math.min(at - ti, 10) * 0.1;
    prev = at;
    ti = at + 1;
  }
  return score;
}

export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const t = text.toLowerCase();
  // Try every place the first letter appears and keep the best.
  let best: number | null = null;
  for (let i = t.indexOf(q[0]); i >= 0; i = t.indexOf(q[0], i + 1)) {
    const s = greedy(q, t, i);
    if (s !== null && (best === null || s > best)) best = s;
  }
  if (best === null) return null;
  const words = query.trim().toLowerCase().split(/\s+/);
  for (const w of words) {
    const at = t.indexOf(w);
    if (at >= 0) best += at === 0 || BOUNDARY.test(t[at - 1]) ? 10 : 5;
  }
  return best;
}

export function rank<T>(items: T[], query: string, label: (t: T) => string): T[] {
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, label(item)) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => (b.s as number) - (a.s as number) || a.i - b.i)
    .map((x) => x.item);
}
