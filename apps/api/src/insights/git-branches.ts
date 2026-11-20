import type { BranchInfo, CommitRef, RepoBranches, WorktreeInfo } from '@overlook/shared';
import { git } from '../common/git';

export const STALE_DAYS = 30;

/** `git for-each-ref` format: one branch per line, tab-separated, subject last (it may contain tabs). */
export const BRANCH_FORMAT = ['%(refname:short)', '%(HEAD)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:iso-strict)', '%(contents:subject)'].join('%09');

/** Parses `git for-each-ref --format=BRANCH_FORMAT refs/heads`; `merged` names the branches merged into HEAD. */
export function parseBranches(out: string, merged: Set<string>, now = Date.now(), staleDays = STALE_DAYS): BranchInfo[] {
  const branches: BranchInfo[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [name, head, upstream, track, date, ...subject] = line.replace(/\r$/, '').split('\t');
    if (!name) continue;
    const current = head === '*';
    const at = date ? new Date(date) : null;
    const lastCommitAt = at && !Number.isNaN(at.getTime()) ? at.toISOString() : null;
    branches.push({
      name,
      current,
      upstream: upstream || null,
      ahead: Number(/ahead (\d+)/.exec(track ?? '')?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track ?? '')?.[1] ?? 0),
      upstreamGone: /\bgone\b/.test(track ?? ''),
      lastCommitAt,
      lastCommitSubject: subject.join('\t') || null,
      merged: !current && merged.has(name),
      stale: !current && !!lastCommitAt && now - Date.parse(lastCommitAt) > staleDays * 86_400_000,
    });
  }
  // Checked-out branch first, then newest commit first.
  return branches.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? ''));
}

/** Parses `git branch --merged HEAD --format=%(refname:short)` (skips "(HEAD detached …)" lines). */
export function parseMerged(out: string): Set<string> {
  return new Set(out.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('(')));
}

/** Parses `git worktree list --porcelain`: blocks separated by blank lines, the first is the main worktree. */
export function parseWorktrees(out: string): WorktreeInfo[] {
  const list: WorktreeInfo[] = [];
  let cur: WorktreeInfo | null = null;
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) { cur = null; continue; }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') {
      cur = { path: value, branch: null, head: null, main: list.length === 0, bare: false, detached: false, locked: false, prunable: false };
      list.push(cur);
    } else if (cur) {
      if (key === 'HEAD') cur.head = value;
      else if (key === 'branch') cur.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'detached') cur.detached = true;
      else if (key === 'bare') cur.bare = true;
      else if (key === 'locked') cur.locked = true;
      else if (key === 'prunable') cur.prunable = true;
    }
  }
  return list;
}

/** Local branches (with upstream tracking, stale and merged flags) and worktrees of one repository. Read-only. */
export async function repoBranches(path: string, now = Date.now()): Promise<RepoBranches> {
  const out: RepoBranches = { path, staleDays: STALE_DAYS, branches: [], worktrees: [] };
  try {
    const [refs, merged, worktrees] = await Promise.all([
      git(path, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads']),
      git(path, ['branch', '--merged', 'HEAD', '--format=%(refname:short)']).catch(() => ''), // no commits yet
      git(path, ['worktree', 'list', '--porcelain']).catch(() => ''),
    ]);
    out.branches = parseBranches(refs, parseMerged(merged), now);
    out.worktrees = parseWorktrees(worktrees);
  } catch (e) {
    out.error = e instanceof Error ? e.message.split('\n')[0] : String(e);
  }
  return out;
}

/** Parses `git log --format=%H%x09%cI%x09%s`. */
export function parseCommits(out: string, repo: string): CommitRef[] {
  return out.split('\n').filter((l) => l.trim()).map((l) => {
    const [hash, at, ...subject] = l.replace(/\r$/, '').split('\t');
    return { hash, at: new Date(at).toISOString(), subject: subject.join('\t'), repo };
  });
}

/**
 * Commits on HEAD with a committer date in [since, until): the count, and the newest `limit` of them.
 * Empty for a repository without commits.
 */
export async function commitsBetween(path: string, repo: string, since: string, until: string | null, limit = 10): Promise<{ count: number; recent: CommitRef[] }> {
  const range = [`--since=${since}`, ...(until ? [`--until=${until}`] : [])];
  try {
    const [count, log] = await Promise.all([
      git(path, ['rev-list', '--count', ...range, 'HEAD']),
      git(path, ['log', ...range, `--max-count=${limit}`, '--format=%H%x09%cI%x09%s', 'HEAD']),
    ]);
    return { count: Number(count.trim()) || 0, recent: parseCommits(log, repo) };
  } catch {
    return { count: 0, recent: [] };
  }
}
