import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Skeleton } from 'primereact/skeleton';
import Layout from './layout/Layout';
import OverviewPage from './pages/OverviewPage';

// The overview loads with the app; other pages are fetched when first opened.
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'));
const BoardPage = lazy(() => import('./pages/BoardPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ClaudePage = lazy(() => import('./pages/InsightsPages').then((m) => ({ default: m.ClaudePage })));
const GitPage = lazy(() => import('./pages/InsightsPages').then((m) => ({ default: m.GitPage })));
const SummaryPage = lazy(() => import('./pages/SummaryPage'));

const page = (el: ReactElement) => <Suspense fallback={<Skeleton height="20rem" />}>{el}</Suspense>;

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="projects" element={page(<ProjectsPage />)} />
        <Route path="projects/:id" element={page(<ProjectDetailPage />)} />
        <Route path="board" element={page(<BoardPage />)} />
        <Route path="claude" element={page(<ClaudePage />)} />
        <Route path="git" element={page(<GitPage />)} />
        <Route path="summary" element={page(<SummaryPage />)} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
