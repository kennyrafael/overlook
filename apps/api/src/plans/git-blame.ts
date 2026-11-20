/**
 * Parses `git blame --porcelain` output into the author time of each final line.
 * Porcelain prints a commit's headers (author-time, …) only the first time the commit appears,
 * so times are remembered per commit. Lines from the all-zero commit are not committed yet: null.
 */
export function parseBlamePorcelain(out: string): Map<number, string | null> {
  const times = new Map<string, number>();
  const lines = new Map<number, string | null>();
  let sha = '';
  let finalLine = 0;
  const pending: { sha: string; line: number }[] = [];
  for (const row of out.split(/\r?\n/)) {
    const head = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(row);
    if (head) {
      sha = head[1];
      finalLine = Number(head[2]);
      pending.push({ sha, line: finalLine });
      continue;
    }
    const t = /^author-time (\d+)$/.exec(row);
    if (t && sha) times.set(sha, Number(t[1]));
  }
  for (const p of pending) {
    const at = /^0+$/.test(p.sha) ? undefined : times.get(p.sha);
    lines.set(p.line, at === undefined ? null : new Date(at * 1000).toISOString());
  }
  return lines;
}

/** `-L n,n` arguments for these lines, merging runs of consecutive lines. */
export function lineRanges(lines: number[]): string[] {
  const sorted = [...new Set(lines)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const args: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    args.push('-L', `${sorted[i]},${sorted[j]}`);
    i = j + 1;
  }
  return args;
}
