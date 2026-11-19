import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ProjectsLayout = 'cards' | 'list';

interface LayoutState {
  layout: ProjectsLayout;
  setLayout: (layout: ProjectsLayout) => void;
}

/** How the Projects page shows projects: a grid of cards (default) or the sortable table. */
export const useProjectsLayout = create<LayoutState>()(
  persist(
    (set) => ({
      layout: 'cards',
      setLayout: (layout) => set({ layout }),
    }),
    {
      name: 'cpd-projects-layout',
      // Per-viewer convenience only; the page works if storage is unavailable.
      storage: createJSONStorage(() => {
        try { localStorage.setItem('cpd-probe', '1'); localStorage.removeItem('cpd-probe'); return localStorage; }
        catch { return sessionStorage; }
      }),
      partialize: ({ layout }) => ({ layout }),
    },
  ),
);
