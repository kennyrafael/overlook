import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Project, ProjectSource, ProjectStatus } from '@overlook/shared';

export type ActivityBucket = 'today' | 'week' | 'month' | 'quarter' | 'older' | 'never';

export const ACTIVITY_BUCKETS: { value: ActivityBucket; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'Last 90 days' },
  { value: 'older', label: 'Older' },
  { value: 'never', label: 'No activity' },
];

export interface Filters {
  search: string;
  statuses: ProjectStatus[];
  tags: string[];
  sources: ProjectSource[];
  activity: ActivityBucket[];
  projectIds: string[];
  /** Only projects that have plan milestones. */
  plannedOnly: boolean;
}

/** Dimensions a chart can cross-filter on (each chart ignores its own when computing its data). */
export type Dimension = 'statuses' | 'tags' | 'sources' | 'activity' | 'projectIds';

const EMPTY: Filters = { search: '', statuses: [], tags: [], sources: [], activity: [], projectIds: [], plannedOnly: false };

interface FilterState extends Filters {
  set: (patch: Partial<Filters>) => void;
  /** Add the value if missing, remove it if present. */
  toggle: <D extends Dimension>(dim: D, value: Filters[D][number]) => void;
  clear: (dim?: keyof Filters) => void;
}

export const useFilters = create<FilterState>()(
  persist(
    (set, get) => ({
      ...EMPTY,
      set: (patch) => set(patch),
      toggle: (dim, value) => {
        const list = get()[dim] as unknown[];
        set({ [dim]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] } as Partial<Filters>);
      },
      clear: (dim) => set(dim ? { [dim]: EMPTY[dim] } as Partial<Filters> : EMPTY),
    }),
    {
      name: 'cpd-filters',
      // Per-viewer convenience only; the page works if storage is unavailable.
      storage: createJSONStorage(() => {
        try { localStorage.setItem('cpd-probe', '1'); localStorage.removeItem('cpd-probe'); return localStorage; }
        catch { return sessionStorage; }
      }),
      partialize: ({ set: _s, toggle: _t, clear: _c, ...rest }) => rest,
    },
  ),
);

const DAY = 86_400_000;

export function activityBucket(p: Project, now = Date.now()): ActivityBucket {
  if (!p.lastActivityAt) return 'never';
  const t = new Date(p.lastActivityAt).getTime();
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (t >= startOfToday) return 'today';
  const age = now - t;
  if (age < 7 * DAY) return 'week';
  if (age < 30 * DAY) return 'month';
  if (age < 90 * DAY) return 'quarter';
  return 'older';
}

/** Applies all filters except the `skip` dimension (so a chart still shows its unselected options). */
export function filterProjects(projects: Project[], f: Filters, skip?: Dimension): Project[] {
  const q = f.search.trim().toLowerCase();
  return projects.filter((p) =>
    (skip === 'statuses' || !f.statuses.length || f.statuses.includes(p.status))
    && (skip === 'tags' || !f.tags.length || f.tags.some((t) => p.tags.includes(t)))
    && (skip === 'sources' || !f.sources.length || f.sources.includes(p.source))
    && (skip === 'activity' || !f.activity.length || f.activity.includes(activityBucket(p)))
    && (skip === 'projectIds' || !f.projectIds.length || f.projectIds.includes(p.id))
    && (!f.plannedOnly || p.milestonesTotal > 0)
    && (!q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))),
  );
}

export function activeFilterCount(f: Filters): number {
  return f.statuses.length + f.tags.length + f.sources.length + f.activity.length + f.projectIds.length
    + (f.search.trim() ? 1 : 0) + (f.plannedOnly ? 1 : 0);
}
