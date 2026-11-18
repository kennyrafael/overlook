import { useMemo } from 'react';
import { activeFilterCount, filterProjects, useFilters } from '../store/filters';
import { useProjects } from '../store/projects';

/**
 * Project ids selected by the global filters, or undefined when no filter is active
 * (meaning "everything", including usage outside any project).
 */
export function useInsightScope(): { ids: string[] | undefined; key: string } {
  const projects = useProjects((s) => s.projects);
  const filters = useFilters();
  return useMemo(() => {
    if (!activeFilterCount(filters)) return { ids: undefined, key: 'all' };
    const ids = filterProjects(projects, filters).map((p) => p.id);
    const list = ids.length ? ids : ['__none__'];
    return { ids: list, key: list.join(',') };
  }, [projects, filters]);
}
