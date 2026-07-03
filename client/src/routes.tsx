import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import AppShell from './components/layout/AppShell.tsx';
import RouteErrorBoundary from './components/shared/RouteErrorBoundary.tsx';

// Eagerly-loaded: small components that are part of the shell or appear immediately
import WorldList from './components/world/WorldList.tsx';
import WorldCreationWizard from './components/world/WorldCreationWizard.tsx';
import WorldSettings from './components/world/WorldSettings.tsx';
import ArticlePage from './components/article/ArticlePage.tsx';

// Lazy-loaded: secondary pages loaded on first navigation
const WorldOverviewPage = lazy(() => import('./pages/WorldOverviewPage.tsx'));
const TimelinePage      = lazy(() => import('./pages/TimelinePage.tsx'));
const GraphPage         = lazy(() => import('./pages/GraphPage.tsx'));
const SnapshotsPage     = lazy(() => import('./pages/SnapshotsPage.tsx'));
const UsagePage         = lazy(() => import('./pages/UsagePage.tsx'));
const ToolboxPage       = lazy(() => import('./pages/ToolboxPage.tsx'));
const PublishPage       = lazy(() => import('./pages/PublishPage.tsx'));
const InboxPage         = lazy(() => import('./pages/InboxPage.tsx'));

function PageFallback() {
  return <div className="p-8 text-sm text-zinc-400">Loading…</div>;
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <WorldList /> },
      { path: 'new',  element: <WorldCreationWizard /> },
      {
        path: 'worlds/:wid',
        element: <AppShell />,
        children: [
          { index: true,           element: withSuspense(<WorldOverviewPage />) },
          { path: 'articles/:aid', element: <ArticlePage /> },
          { path: 'timeline',      element: withSuspense(<TimelinePage />) },
          { path: 'graph',         element: withSuspense(<GraphPage />) },
          { path: 'snapshots',     element: withSuspense(<SnapshotsPage />) },
          { path: 'usage',         element: withSuspense(<UsagePage />) },
          { path: 'inbox',         element: withSuspense(<InboxPage />) },
          { path: 'toolbox',       element: withSuspense(<ToolboxPage />) },
          { path: 'publish',       element: withSuspense(<PublishPage />) },
          { path: 'settings',      element: <WorldSettings /> },
        ],
      },
    ],
  },
]);
