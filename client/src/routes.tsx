import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import AppShell from './components/layout/AppShell.tsx';

// Eagerly-loaded: small components that are part of the shell or appear immediately
import WorldList from './components/world/WorldList.tsx';
import WorldCreationWizard from './components/world/WorldCreationWizard.tsx';
import WorldSettings from './components/world/WorldSettings.tsx';
import ArticlePage from './components/article/ArticlePage.tsx';

// Lazy-loaded: secondary pages loaded on first navigation
const WorldOverviewPage = lazy(() => import('./pages/WorldOverviewPage.tsx'));
const TimelinePage      = lazy(() => import('./pages/TimelinePage.tsx'));
const SnapshotsPage     = lazy(() => import('./pages/SnapshotsPage.tsx'));
const UsagePage         = lazy(() => import('./pages/UsagePage.tsx'));

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
          { path: 'snapshots',     element: withSuspense(<SnapshotsPage />) },
          { path: 'usage',         element: withSuspense(<UsagePage />) },
          { path: 'settings',      element: <WorldSettings /> },
        ],
      },
    ],
  },
]);
