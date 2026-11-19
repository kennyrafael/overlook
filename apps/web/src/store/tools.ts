import { create } from 'zustand';
import type { ProjectAction, SystemTools } from '@overlook/shared';
import { api } from '../api';

interface ToolsState {
  tools: SystemTools | null;
  load: (force?: boolean) => Promise<SystemTools | null>;
}

let inFlight: Promise<SystemTools | null> | null = null;

/** Detected local tools (git, Claude Code, VS Code, terminal, WSL). Loaded once, refreshable. */
export const useTools = create<ToolsState>((set, get) => ({
  tools: null,
  load: (force = false) => {
    if (get().tools && !force) return Promise.resolve(get().tools);
    inFlight ??= api.tools()
      .then((tools) => { set({ tools }); return tools; })
      .catch(() => null)
      .finally(() => { inFlight = null; });
    return inFlight;
  },
}));

/** Quick actions that can work on this machine. Unknown (still loading) counts as available. */
export function actionAvailable(tools: SystemTools | null, action: ProjectAction): boolean {
  if (!tools) return true;
  if (action === 'vscode') return tools.vscode;
  if (action === 'claude') return tools.claude && !!tools.terminal;
  if (action === 'terminal') return !!tools.terminal;
  if (action === 'explorer') return tools.openFolder !== false; // false only on Linux without xdg-open
  return true;
}
