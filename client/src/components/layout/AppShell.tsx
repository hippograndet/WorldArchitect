import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { resolveTheme } from '../../lib/theme.ts';
import TopBar from './TopBar.tsx';
import Sidebar from './Sidebar.tsx';
import ConfirmDialog from '../shared/ConfirmDialog.tsx';
import AgentPanel from '../agent/AgentPanel.tsx';

export default function AppShell() {
  const { wid } = useParams<{ wid: string }>();
  const { loadWorlds, selectWorld, loadTree, loadBibleMeta, worlds, currentWorldId } = useStore();

  useEffect(() => {
    if (worlds.length === 0) loadWorlds().catch(console.error);
  }, [worlds.length, loadWorlds]);

  useEffect(() => {
    if (!wid) return;
    selectWorld(wid);
    loadTree(wid).catch(console.error);
    loadBibleMeta(wid).catch(console.error);
  }, [wid, selectWorld, loadTree, loadBibleMeta]);

  const currentWorld = worlds.find((w) => w.id === (wid ?? currentWorldId));
  const theme = resolveTheme(currentWorld);

  return (
    <div className="flex flex-col h-screen bg-surface" data-theme={theme !== 'default' ? theme : undefined}>
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-surface">
          <Outlet />
        </main>
      </div>
      <ConfirmDialog />
      <AgentPanel />
    </div>
  );
}
