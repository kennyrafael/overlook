import { create } from 'zustand';
import type { LiveEvent } from '@overlook/shared';
import { appToast } from '../toast';
import { useProjects } from './projects';

/**
 * Live update counters. Components read the counter(s) they care about and
 * re-fetch when it changes; the server pushes events over SSE (/api/events).
 */
interface LiveState {
  connected: boolean;
  git: number;
  claude: number;
  snapshots: number;
  /** Per-project plan version, bumped on every plan change (external or from another tab). */
  projects: Record<string, number>;
  /** Projects named by the most recent git / claude event ([] = all). */
  lastGitIds: string[];
  lastClaudeIds: string[];
}

export const useLive = create<LiveState>(() => ({
  connected: false, git: 0, claude: 0, snapshots: 0, projects: {}, lastGitIds: [], lastClaudeIds: [],
}));

function bumpProject(id: string) {
  useLive.setState((s) => ({ projects: { ...s.projects, [id]: (s.projects[id] ?? 0) + 1 }, snapshots: s.snapshots + 1 }));
}

function handle(e: LiveEvent) {
  switch (e.type) {
    case 'project:updated': {
      bumpProject(e.projectId);
      useProjects.getState().load();
      if (e.source === 'external') {
        const name = useProjects.getState().projects.find((p) => p.id === e.projectId)?.name ?? 'A project';
        appToast.current?.show({ severity: 'info', summary: `${name} plan updated`, detail: e.file ? `${e.file} changed on disk` : undefined, life: 3500 });
      }
      break;
    }
    case 'projects:rescanned':
      useProjects.getState().load();
      useLive.setState((s) => ({ snapshots: s.snapshots + 1 }));
      break;
    case 'git:updated':
      useLive.setState((s) => ({ git: s.git + 1, lastGitIds: e.projectIds }));
      break;
    case 'claude:updated':
      useLive.setState((s) => ({ claude: s.claude + 1, lastClaudeIds: e.projectIds }));
      break;
    case 'snapshots:updated':
      useLive.setState((s) => ({ snapshots: s.snapshots + 1 }));
      break;
  }
}

const TYPES: LiveEvent['type'][] = ['hello', 'project:updated', 'projects:rescanned', 'git:updated', 'claude:updated', 'snapshots:updated'];

/** Opens the SSE connection once; EventSource reconnects by itself. Returns a cleanup function. */
export function connectLive(): () => void {
  const es = new EventSource('/api/events');
  let hadError = false;

  for (const type of TYPES) {
    es.addEventListener(type, (msg) => {
      try { handle(JSON.parse((msg as MessageEvent).data) as LiveEvent); } catch { /* ignore malformed */ }
    });
  }
  es.onopen = () => {
    useLive.setState({ connected: true });
    if (hadError) {
      // Missed events while disconnected: refresh everything once.
      hadError = false;
      useProjects.getState().load();
      useLive.setState((s) => ({ git: s.git + 1, claude: s.claude + 1, snapshots: s.snapshots + 1, lastGitIds: [], lastClaudeIds: [] }));
    }
  };
  es.onerror = () => {
    hadError = true;
    useLive.setState({ connected: false });
  };
  return () => es.close();
}
