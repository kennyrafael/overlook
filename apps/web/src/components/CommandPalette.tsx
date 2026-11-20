import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import type { ProjectAction } from '@overlook/shared';
import { ACTION_META, runProjectAction } from '../actions/projectActions';
import { useFilters } from '../store/filters';
import { useProjects } from '../store/projects';
import { useViews } from '../store/views';
import { actionAvailable, useTools } from '../store/tools';
import { useTheme } from '../theme/ThemeContext';
import { appToast } from '../toast';
import { MOD } from '../platform';
import { openFeedback } from './FeedbackDialog';

interface Command {
  id: string;
  group: 'Pages' | 'Projects' | 'Actions' | 'Views' | 'Commands';
  label: string;
  hint?: string;
  icon: string;
  keywords?: string;
  run: () => void;
}

const PAGES = [
  { label: 'Overview', to: '/', icon: 'pi pi-chart-bar' },
  { label: 'Projects', to: '/projects', icon: 'pi pi-folder' },
  { label: 'Board', to: '/board', icon: 'pi pi-th-large' },
  { label: 'Claude usage', to: '/claude', icon: 'pi pi-microchip-ai' },
  { label: 'Git activity', to: '/git', icon: 'pi pi-github' },
  { label: 'Weekly summary', to: '/summary', icon: 'pi pi-calendar' },
  { label: 'Settings', to: '/settings', icon: 'pi pi-cog' },
];

const ACTION_ORDER: ProjectAction[] = ['vscode', 'claude', 'terminal', 'explorer'];
const GROUP_ORDER: Command['group'][] = ['Pages', 'Views', 'Projects', 'Actions', 'Commands'];
const LIMIT = 40;

/** Every query word must appear; earlier and word-start matches rank higher. */
function score(c: Command, words: string[]): number {
  const hay = `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase();
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return -1;
    s += i === 0 ? 30 : /[\s:›/-]/.test(hay[i - 1] ?? '') ? 20 : 10 - Math.min(9, i / 10);
  }
  return s;
}

/** Ctrl+K / ⌘K: jump to pages and projects, run project actions, apply saved views. */
export default function CommandPalette() {
  const navigate = useNavigate();
  const { toggle: toggleTheme, mode } = useTheme();
  const projects = useProjects((s) => s.projects);
  const views = useViews((s) => s.views);
  const tools = useTools((s) => s.tools);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('cpd:open-palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('cpd:open-palette', onOpen); };
  }, []);

  useEffect(() => { if (open) { setQuery(''); setActive(0); } }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const list: Command[] = PAGES.map((p) => ({ id: `page:${p.to}`, group: 'Pages', label: p.label, icon: p.icon, keywords: 'go page', run: go(p.to) }));
    for (const v of views) {
      list.push({ id: `view:${v.id}`, group: 'Views', label: v.name, hint: 'Apply saved view', icon: 'pi pi-bookmark', keywords: 'view filter', run: () => useViews.getState().apply(v) });
    }
    for (const p of projects) {
      list.push({ id: `project:${p.id}`, group: 'Projects', label: p.name, hint: `${p.progress}% · ${p.status}`, icon: p.pinned ? 'pi pi-star-fill' : 'pi pi-folder', keywords: `open project ${p.path} ${p.tags.join(' ')}`, run: go(`/projects/${p.id}`) });
      if (p.exists) {
        for (const a of ACTION_ORDER.filter((x) => actionAvailable(tools, x))) {
          list.push({ id: `action:${a}:${p.id}`, group: 'Actions', label: `${p.name}: ${ACTION_META[a].label}`, icon: ACTION_META[a].icon, keywords: a, run: () => runProjectAction(p, a) });
        }
        list.push({ id: `board:${p.id}`, group: 'Actions', label: `${p.name}: Show board`, icon: 'pi pi-th-large', keywords: 'kanban tasks', run: () => { useFilters.getState().set({ projectIds: [p.id] }); navigate('/board'); } });
      }
    }
    list.push(
      { id: 'cmd:rescan', group: 'Commands', label: 'Rescan projects', icon: 'pi pi-refresh', keywords: 'reload discover', run: () => {
        useProjects.getState().rescan()
          .then((ps) => appToast.current?.show({ severity: 'success', summary: `Found ${ps.length} projects`, life: 2000 }))
          .catch((e) => appToast.current?.show({ severity: 'error', summary: 'Rescan failed', detail: String(e) }));
      } },
      { id: 'cmd:theme', group: 'Commands', label: `Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`, icon: mode === 'dark' ? 'pi pi-sun' : 'pi pi-moon', keywords: 'theme dark light mode', run: toggleTheme },
      { id: 'cmd:clear', group: 'Commands', label: 'Clear all filters', icon: 'pi pi-filter-slash', keywords: 'reset filters', run: () => useFilters.getState().clear() },
      { id: 'cmd:feedback-pro', group: 'Commands', label: 'Feedback: would you pay for Overlook?', icon: 'pi pi-comments', keywords: 'feedback pro price pay survey', run: () => openFeedback('pro') },
      { id: 'cmd:feedback-idea', group: 'Commands', label: 'Feedback: suggest a feature', icon: 'pi pi-lightbulb', keywords: 'feedback idea feature request suggestion', run: () => openFeedback('idea') },
      { id: 'cmd:about', group: 'Commands', label: 'About Overlook', icon: 'pi pi-info-circle', keywords: 'about version license notices', run: () => window.dispatchEvent(new Event('cpd:open-about')) },
    );
    return list;
  }, [projects, views, tools, navigate, mode, toggleTheme]);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      // Without a query, show pages, views, commands and pinned/first projects; actions appear when typing.
      const projectsShown = commands.filter((c) => c.group === 'Projects').slice(0, 8);
      return [...commands.filter((c) => c.group !== 'Projects' && c.group !== 'Actions'), ...projectsShown]
        .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    }
    return commands
      .map((c) => ({ c, s: score(c, words) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || GROUP_ORDER.indexOf(a.c.group) - GROUP_ORDER.indexOf(b.c.group))
      .slice(0, LIMIT)
      .map((x) => x.c);
  }, [commands, query]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runAt = (i: number) => {
    const c = results[i];
    if (!c) return;
    setOpen(false);
    // Let the dialog close before navigating or opening other dialogs.
    setTimeout(c.run, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(active); }
  };

  let lastGroup: string | null = null;
  return (
    <Dialog visible={open} onHide={() => setOpen(false)} showHeader={false} dismissableMask modal
      position="top" style={{ width: 'min(40rem, 95vw)', marginTop: '10vh' }} contentClassName="p-0 border-round"
      onShow={() => inputRef.current?.focus()}>
      <div className="flex align-items-center gap-2 px-3 py-2 border-bottom-1 surface-border">
        <i className="pi pi-search text-500" />
        <InputText ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Search pages, projects, actions, views…" className="flex-grow-1 border-none shadow-none"
          aria-label="Command search" aria-controls="palette-list" aria-activedescendant={results[active] ? `palette-${active}` : undefined} />
        <kbd className="palette-kbd">Esc</kbd>
      </div>
      <div ref={listRef} id="palette-list" role="listbox" className="palette-list">
        {!results.length && <div className="p-4 text-500 text-center">No matches</div>}
        {results.map((c, i) => {
          const header = c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <div key={c.id}>
              {header && <div className="palette-group">{header}</div>}
              <div id={`palette-${i}`} data-index={i} role="option" aria-selected={i === active}
                className={`palette-item ${i === active ? 'palette-item-active' : ''}`}
                onMouseMove={() => setActive(i)} onClick={() => runAt(i)}>
                <i className={`${c.icon} palette-icon`} />
                <span className="flex-grow-1 white-space-nowrap overflow-hidden text-overflow-ellipsis">{c.label}</span>
                {c.hint && <small className="text-500 white-space-nowrap">{c.hint}</small>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 px-3 py-2 border-top-1 surface-border text-500 text-sm">
        <span><kbd className="palette-kbd">↑</kbd><kbd className="palette-kbd">↓</kbd> move</span>
        <span><kbd className="palette-kbd">Enter</kbd> run</span>
        <span className="ml-auto"><kbd className="palette-kbd">{MOD}</kbd><kbd className="palette-kbd">K</kbd> toggle</span>
      </div>
    </Dialog>
  );
}
