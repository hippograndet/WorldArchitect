import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import App from './App.tsx';
import AppShell from './components/layout/AppShell.tsx';
import RouteErrorBoundary from './components/shared/RouteErrorBoundary.tsx';

// Eagerly-loaded: small components that are part of the shell or appear immediately
import WorldList from './components/world/WorldList.tsx';
import WorldCreationWizard from './components/world/WorldCreationWizard.tsx';
import WorldSettings from './components/world/WorldSettings.tsx';
import AppSettingsPage from './pages/AppSettingsPage.tsx';
import ArticlePage from './components/article/ArticlePage.tsx';

// Lazy-loaded: secondary pages loaded on first navigation
const WorldOverviewPage = lazy(() => import('./pages/WorldOverviewPage.tsx'));
const GraphPage         = lazy(() => import('./pages/GraphPage.tsx'));
const SnapshotsPage     = lazy(() => import('./pages/SnapshotsPage.tsx'));
const UsagePage         = lazy(() => import('./pages/UsagePage.tsx'));
const ToolboxPage       = lazy(() => import('./pages/ToolboxPage.tsx'));
const ExpandPage        = lazy(() => import('./pages/ExpandPage.tsx'));
const ConsolidatePage   = lazy(() => import('./pages/ConsolidatePage.tsx'));
const InboxPage         = lazy(() => import('./pages/InboxPage.tsx'));
const PublishPage       = lazy(() => import('./pages/PublishPage.tsx'));

function PageFallback() {
  return <div className="p-8 text-sm text-zinc-400">Loading…</div>;
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>;
}

// `../grow` alone would drop the query string; old /expand links and
// in-app navigations both rely on ?start=/&version= surviving the redirect.
function ExpandToGrowRedirect() {
  const { search } = useLocation();
  return <Navigate to={`../grow${search}`} replace />;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <WorldList /> },
      { path: 'new',  element: <WorldCreationWizard /> },
      { path: 'settings', element: <AppSettingsPage /> },
      {
        path: 'worlds/:wid',
        element: <AppShell />,
        children: [
          { index: true,           element: withSuspense(<WorldOverviewPage />) },
          { path: 'articles/:aid', element: <ArticlePage /> },
          { path: 'graph',         element: withSuspense(<GraphPage />) },
          { path: 'snapshots',     element: withSuspense(<SnapshotsPage />) },
          { path: 'usage',         element: withSuspense(<UsagePage />) },
          { path: 'grow',          element: withSuspense(<ExpandPage />) },
          { path: 'expand',        element: <ExpandToGrowRedirect /> },
          { path: 'inbox',         element: withSuspense(<InboxPage />) },
          { path: 'consolidate',   element: withSuspense(<ConsolidatePage />) },
          { path: 'toolbox',       element: withSuspense(<ToolboxPage />) },
          { path: 'publish',       element: withSuspense(<PublishPage />) },
          { path: 'settings',      element: <WorldSettings /> },
        ],
      },
    ],
  },
]);
