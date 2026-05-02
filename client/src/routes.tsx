import { createBrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import WorldList from './components/world/WorldList.tsx';
import WorldCreationWizard from './components/world/WorldCreationWizard.tsx';
import WorldSettings from './components/world/WorldSettings.tsx';
import AppShell from './components/layout/AppShell.tsx';
import ArticlePage from './components/article/ArticlePage.tsx';
import WorldOverviewPage from './pages/WorldOverviewPage.tsx';
import TimelinePage from './pages/TimelinePage.tsx';
import SnapshotsPage from './pages/SnapshotsPage.tsx';
import UsagePage from './pages/UsagePage.tsx';

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
          { index: true,           element: <WorldOverviewPage /> },
          { path: 'articles/:aid', element: <ArticlePage /> },
          { path: 'timeline',      element: <TimelinePage /> },
          { path: 'snapshots',     element: <SnapshotsPage /> },
          { path: 'usage',         element: <UsagePage /> },
          { path: 'settings',      element: <WorldSettings /> },
        ],
      },
    ],
  },
]);
