import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../stores/index.ts';
import { api } from '../lib/api.ts';
import WorkspaceLayout from '../components/shared/WorkspaceLayout.tsx';
import IssueQueueSidebar from '../components/consolidate/IssueQueueSidebar.tsx';
import IssueDetailView from '../components/consolidate/IssueDetailView.tsx';
import AuditLauncherPanel from '../components/consolidate/AuditLauncherPanel.tsx';
import type { ConsolidationIssue } from '../lib/consolidation.ts';

export default function ConsolidatePage() {
  const { wid } = useParams<{ wid: string }>();
  const [searchParams] = useSearchParams();
  const { agentPanelOpen } = useStore();

  const [issues, setIssues] = useState<ConsolidationIssue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const deepLinkedIssueId = searchParams.get('issue');
  const preselectedArticleId = searchParams.get('article');

  const loadIssues = useCallback(async () => {
    if (!wid) return;
    const list = await api.consolidation.list(wid);
    setIssues(list);
  }, [wid]);

  useEffect(() => { loadIssues().catch(console.error); }, [loadIssues]);

  useEffect(() => {
    if (deepLinkedIssueId) setSelectedId(deepLinkedIssueId);
  }, [deepLinkedIssueId]);

  // Refetch once a dispatched subsystem (Audit / Coherence Check / Reorganize) finishes
  // and the floating agent panel closes — it mutates world_issues/article_issues server-side
  // without this page knowing otherwise.
  const wasPanelOpen = useRef(agentPanelOpen);
  useEffect(() => {
    if (wasPanelOpen.current && !agentPanelOpen) {
      loadIssues().catch(console.error);
    }
    wasPanelOpen.current = agentPanelOpen;
  }, [agentPanelOpen, loadIssues]);

  const selectedIssue = issues.find((i) => i.id === selectedId) ?? null;

  if (!wid) return null;

  return (
    <WorkspaceLayout
      rightOpen={settingsOpen}
      left={<IssueQueueSidebar issues={issues} selectedId={selectedId} onSelect={setSelectedId} />}
      center={
        <>
          {!settingsOpen && (
            <div className="px-6 pt-4">
              <button
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                <PanelRightOpen size={14} />
                Show Tools
              </button>
            </div>
          )}
          <IssueDetailView wid={wid} issue={selectedIssue} onChanged={() => loadIssues().catch(console.error)} />
        </>
      }
      right={
        <AuditLauncherPanel
          wid={wid}
          onHide={() => setSettingsOpen(false)}
          preselectedArticleId={preselectedArticleId}
        />
      }
    />
  );
}
