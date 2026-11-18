import { create } from 'zustand';
import type { Project, ProjectPatch } from '@overlook/shared';
import { api } from '../api';

interface ProjectsState {
  projects: Project[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  rescan: () => Promise<Project[]>;
  update: (id: string, patch: ProjectPatch) => Promise<Project>;
}

let reloadQueued = false;

const sortProjects =(ps: Project[]) =>
  [...ps].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));

/** Single shared copy of the project list, so every page and chart sees the same data. */
export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    // A reload requested mid-flight (e.g. a live event) runs once more afterwards.
    if (get().loading) { reloadQueued = true; return; }
    set({ loading: true, error: null });
    try {
      set({ projects: sortProjects(await api.projects()), loaded: true });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ loading: false });
      if (reloadQueued) { reloadQueued = false; get().load(); }
    }
  },

  rescan: async () => {
    set({ loading: true, error: null });
    try {
      const projects = sortProjects(await api.rescan());
      set({ projects, loaded: true });
      return projects;
    } finally {
      set({ loading: false });
    }
  },

  update: async (id, patch) => {
    const updated = await api.updateProject(id, patch);
    set({ projects: sortProjects(get().projects.map((p) => (p.id === id ? updated : p))) });
    return updated;
  },
}));
