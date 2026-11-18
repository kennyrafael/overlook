import { create } from 'zustand';
import type { SavedView, ViewFilters } from '@overlook/shared';
import { api } from '../api';
import { appToast } from '../toast';
import { type ActivityBucket, useFilters } from './filters';

interface ViewsState {
  views: SavedView[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (name: string) => Promise<SavedView | null>;
  overwrite: (view: SavedView) => Promise<void>;
  remove: (view: SavedView) => Promise<void>;
  apply: (view: SavedView) => void;
}

export function currentFilters(): ViewFilters {
  const { search, statuses, tags, sources, activity, projectIds, plannedOnly } = useFilters.getState();
  return { search, statuses, tags, sources, activity, projectIds, plannedOnly };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

/** True when the given filters equal a view's filters (order-insensitive). */
export function matchesView(f: ViewFilters, v: ViewFilters): boolean {
  return f.search.trim() === v.search.trim() && f.plannedOnly === v.plannedOnly
    && sameList(f.statuses, v.statuses) && sameList(f.tags, v.tags) && sameList(f.sources, v.sources)
    && sameList(f.activity, v.activity) && sameList(f.projectIds, v.projectIds);
}

const fail = (summary: string) => (e: unknown) =>
  appToast.current?.show({ severity: 'error', summary, detail: e instanceof Error ? e.message : String(e) });

export const useViews = create<ViewsState>((set, get) => ({
  views: [],
  loaded: false,

  load: async () => {
    try {
      set({ views: await api.views(), loaded: true });
    } catch (e) {
      fail('Could not load saved views')(e);
    }
  },

  save: async (name) => {
    try {
      const v = await api.createView(name, currentFilters());
      set({ views: [...get().views, v].sort((a, b) => a.name.localeCompare(b.name)) });
      appToast.current?.show({ severity: 'success', summary: `Saved view “${v.name}”`, life: 2000 });
      return v;
    } catch (e) {
      fail('Could not save view')(e);
      return null;
    }
  },

  overwrite: async (view) => {
    try {
      const v = await api.updateView(view.id, { filters: currentFilters() });
      set({ views: get().views.map((x) => (x.id === v.id ? v : x)) });
      appToast.current?.show({ severity: 'success', summary: `Updated view “${v.name}”`, life: 2000 });
    } catch (e) {
      fail('Could not update view')(e);
    }
  },

  remove: async (view) => {
    try {
      await api.deleteView(view.id);
      set({ views: get().views.filter((x) => x.id !== view.id) });
    } catch (e) {
      fail('Could not delete view')(e);
    }
  },

  apply: (view) => {
    const f = view.filters;
    useFilters.getState().set({ ...f, activity: f.activity as ActivityBucket[] });
  },
}));
