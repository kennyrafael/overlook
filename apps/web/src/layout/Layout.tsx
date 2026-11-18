import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu } from 'primereact/menu';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { Sidebar } from 'primereact/sidebar';
import { Toast } from 'primereact/toast';
import { ConfirmDialog } from 'primereact/confirmdialog';
import { appToast } from '../toast';
import CommandPalette from '../components/CommandPalette';
import ErrorBoundary from '../components/ErrorBoundary';
import { useViews } from '../store/views';
import type { MenuItem } from 'primereact/menuitem';
import { useTheme } from '../theme/ThemeContext';
import { useProjects } from '../store/projects';
import { connectLive, useLive } from '../store/live';

const NAV = [
  { label: 'Overview', icon: 'pi pi-chart-bar', to: '/' },
  { label: 'Projects', icon: 'pi pi-folder', to: '/projects' },
  { label: 'Board', icon: 'pi pi-th-large', to: '/board' },
  { label: 'Claude', icon: 'pi pi-sparkles', to: '/claude' },
  { label: 'Git', icon: 'pi pi-github', to: '/git' },
  { label: 'Settings', icon: 'pi pi-cog', to: '/settings' },
];

export default function Layout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { mode, toggle } = useTheme();
  const connected = useLive((s) => s.connected);
  const [everConnected, setEverConnected] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadProjects = useProjects((s) => s.load);

  useEffect(() => {
    loadProjects();
    useViews.getState().load();
    return connectLive();
  }, [loadProjects]);

  useEffect(() => { if (connected) setEverConnected(true); }, [connected]);

  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/'));
  const items: MenuItem[] = NAV.map((n) => ({
    label: n.label,
    icon: n.icon,
    className: isActive(n.to) ? 'p-menuitem-active font-bold' : undefined,
    command: () => { setMenuOpen(false); navigate(n.to); },
  }));
  const current = NAV.find((n) => isActive(n.to))?.label ?? '';

  return (
    <div className="layout">
      <aside className="layout-sidebar">
        <div className="brand"><i className="pi pi-sparkles mr-2" />Overlook</div>
        <Menu model={items} />
      </aside>
      <Sidebar visible={menuOpen} onHide={() => setMenuOpen(false)} className="layout-mobile-menu"
        header={<span className="font-bold"><i className="pi pi-sparkles mr-2" />Overlook</span>}>
        <Menu model={items} className="w-full border-none" />
      </Sidebar>
      <div className="layout-main">
        <header className="layout-topbar">
          <div className="flex align-items-center gap-2">
            <Button className="layout-menu-button" rounded text icon="pi pi-bars" aria-label="Open menu" onClick={() => setMenuOpen(true)} />
            <h2 className="m-0 text-xl">{current}</h2>
          </div>
          <div className="flex align-items-center gap-2">
            <Button className="palette-trigger" text size="small" icon="pi pi-search" label="Search"
              badge="Ctrl K" badgeClassName="p-badge-secondary" aria-label="Open command palette (Ctrl+K)"
              onClick={() => window.dispatchEvent(new Event('cpd:open-palette'))} />
            {(connected || everConnected) && (
              <Tag severity={connected ? 'success' : 'warning'}
                icon={connected ? 'pi pi-circle-fill' : 'pi pi-spin pi-spinner'}
                value={connected ? 'Live' : 'Reconnecting…'}
                title={connected ? 'Updates appear as files change' : 'Lost connection to the dashboard server'} />
            )}
            <Button
              rounded text
              icon={mode === 'dark' ? 'pi pi-sun' : 'pi pi-moon'}
              aria-label="Toggle theme"
              onClick={toggle}
            />
          </div>
        </header>
        <main className="layout-content">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
          <Toast ref={appToast} position="bottom-right" />
          <ConfirmDialog />
          <CommandPalette />
        </main>
      </div>
    </div>
  );
}
