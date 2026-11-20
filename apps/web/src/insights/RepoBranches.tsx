import { useEffect, useState } from 'react';
import { Tag } from 'primereact/tag';
import { Message } from 'primereact/message';
import { Skeleton } from 'primereact/skeleton';
import type { BranchInfo, RepoBranches } from '@overlook/shared';
import { api } from '../api';
import { relativeTime } from '../format';
import '../overview/daily.css';

function Sync({ b }: { b: BranchInfo }) {
  if (b.upstreamGone) return <Tag severity="danger" value="upstream gone" title={`${b.upstream} was deleted on the remote`} />;
  if (!b.upstream) return <span className="text-500">local only</span>;
  if (!b.ahead && !b.behind) return <span className="text-500" title={b.upstream}>in sync</span>;
  return (
    <span className="flex gap-1" title={b.upstream}>
      {b.ahead > 0 && <Tag severity="warning" value={`↑ ${b.ahead}`} />}
      {b.behind > 0 && <Tag severity="info" value={`↓ ${b.behind}`} />}
    </span>
  );
}

/** Branches and worktrees of one repository, loaded when its row on the Git page is expanded (read-only). */
export default function RepoBranchesDetail({ projectId, repo }: { projectId: string; repo: string }) {
  const [data, setData] = useState<RepoBranches | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.gitBranches(projectId, repo)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [projectId, repo]);

  if (error) return <Message severity="error" text={`Could not read branches: ${error}`} />;
  if (!data) return <Skeleton height="5rem" />;
  if (data.error) return <Message severity="warn" text={`git: ${data.error}`} />;

  const stale = data.branches.filter((b) => b.stale);
  return (
    <div className="repo-branches grid" data-testid="repo-branches">
      <div className="col-12 xl:col-7">
        <h4>
          Local branches ({data.branches.length})
          {stale.length > 0 && <span className="ml-2 normal-case font-normal">· {stale.length} stale (no commit for {data.staleDays} days)</span>}
        </h4>
        <table>
          <thead><tr><th>Branch</th><th>Upstream</th><th>Last commit</th><th /></tr></thead>
          <tbody>
            {data.branches.map((b) => (
              <tr key={b.name}>
                <td>
                  <span className="flex align-items-center gap-1">
                    {b.current && <i className="pi pi-check text-primary text-sm" title="Checked out" />}
                    <code>{b.name}</code>
                  </span>
                </td>
                <td><Sync b={b} /></td>
                <td>
                  <span title={b.lastCommitAt ?? ''}>{relativeTime(b.lastCommitAt)}</span>
                  {b.lastCommitSubject && <div className="text-500 text-sm white-space-nowrap overflow-hidden text-overflow-ellipsis" style={{ maxWidth: '20rem' }} title={b.lastCommitSubject}>{b.lastCommitSubject}</div>}
                </td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {b.stale && <Tag severity="warning" value="stale" />}
                    {b.merged && <Tag severity="success" value="merged" title="Fully merged into the checked-out branch" />}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="col-12 xl:col-5">
        <h4>Worktrees ({data.worktrees.length})</h4>
        <table>
          <tbody>
            {data.worktrees.map((w) => (
              <tr key={w.path}>
                <td><code>{w.path}</code></td>
                <td>{w.branch ? <code>{w.branch}</code> : <em className="text-500">{w.bare ? 'bare' : 'detached'}</em>}</td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {w.main && <Tag severity="secondary" value="main" />}
                    {w.locked && <Tag severity="info" value="locked" />}
                    {w.prunable && <Tag severity="warning" value="prunable" title="Its folder is gone; `git worktree prune` would remove it" />}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
