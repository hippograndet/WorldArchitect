import { useEffect, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import TopBar from './TopBar.tsx';
import Sidebar from './Sidebar.tsx';
import ConfirmDialog from '../shared/ConfirmDialog.tsx';
import AgentPanel from '../agent/AgentPanel.tsx';

export default function AppShell() {
  const { wid } = useParams<{ wid: string }>();
  const location = useLocation();
  const { loadWorlds, selectWorld, loadTree, loadBibleMeta, worlds } = useStore();
  const [documentsOpen, setDocumentsOpen] = useState(true);
  const pathAfterWorld = wid
    ? location.pathname.replace(`/worlds/${wid}`, '').replace(/^\//, '')
    : '';
  const isWorldWorkspace = !pathAfterWorld.startsWith('usage') && !pathAfterWorld.startsWith('toolbox');
  const showArticleSidebar = isWorldWorkspace && documentsOpen;

  useEffect(() => {
    if (worlds.length === 0) loadWorlds().catch(console.error);
  }, [worlds.length, loadWorlds]);

  useEffect(() => {
    if (!wid) return;
    selectWorld(wid);
    loadTree(wid).catch(console.error);
    loadBibleMeta(wid).catch(console.error);
  }, [wid, selectWorld, loadTree, loadBibleMeta]);

  return (
    <div className="flex flex-col h-screen bg-surface">
      <TopBar
        documentsOpen={documentsOpen}
        onToggleDocuments={() => setDocumentsOpen((open) => !open)}
      />
      <div className="flex flex-1 overflow-hidden">
        {showArticleSidebar && <Sidebar />}
        <main className="flex-1 overflow-y-auto bg-surface">
          <Outlet />
        </main>
      </div>
      <ConfirmDialog />
      <AgentPanel />
    </div>
  );
}
