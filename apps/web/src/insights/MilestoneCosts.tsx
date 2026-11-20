import { useEffect, useState } from 'react';
import { Card } from 'primereact/card';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import type { ClaudeMilestoneCosts } from '@overlook/shared';
import { api } from '../api';
import { formatCompact, formatUsd } from '../format';

type Row = ClaudeMilestoneCosts['milestones'][number];

/** Estimated Claude cost per milestone, from the sessions matched to its tasks (project page). */
export default function MilestoneCosts({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ClaudeMilestoneCosts | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.milestoneCosts(projectId).then((d) => { if (!cancelled) setData(d); }).catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [projectId]);
  if (!data) return null;

  const { milestones, unmatched } = data;
  return (
    <Card title="Estimated Claude cost per milestone" data-testid="milestone-costs"
      subTitle="An estimate from the sessions matched to each milestone's tasks (a guess from titles and prompts), at API list prices">
      {milestones.length === 0 ? (
        <p className="text-500 m-0">No Claude session matched a task of this plan yet.</p>
      ) : (
        <DataTable value={milestones} dataKey="id" size="small">
          <Column field="title" header="Milestone" body={(m: Row) => (
            <span className="flex align-items-center gap-2">
              <i className={m.reached ? 'pi pi-flag-fill text-green-500' : 'pi pi-flag text-500'} />{m.title}
              {m.reached && <Tag value="reached" severity="success" />}
            </span>
          )} />
          <Column field="sessions" header="Sessions" />
          <Column header="Output tokens" body={(m: Row) => formatCompact(m.tokens.output)} />
          <Column field="costUsd" header="Est. cost" body={(m: Row) => formatUsd(m.costUsd)} />
        </DataTable>
      )}
      {unmatched.sessions > 0 && (
        <small className="text-500 block mt-2">
          {unmatched.sessions} other session{unmatched.sessions === 1 ? '' : 's'} ({formatUsd(unmatched.costUsd)}) matched no task.
        </small>
      )}
    </Card>
  );
}
