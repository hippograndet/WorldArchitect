import { useEffect, useMemo, useState } from 'react';
import { Play, ShieldCheck } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import WorkspaceLayout from '../components/shared/WorkspaceLayout.tsx';
import LabelBadge from '../components/shared/LabelBadge.tsx';
import SettingGroup from '../components/shared/SettingGroup.tsx';
import RunListSidebar from '../components/run/RunListSidebar.tsx';
import WorkflowSettingsHeader from '../components/run/WorkflowSettingsHeader.tsx';
import WorkflowCenter from '../components/run/WorkflowCenter.tsx';
import RunDetailHeader from '../components/run/RunDetailHeader.tsx';
import RunStatsGrid from '../components/run/RunStatsGrid.tsx';
import { useWorkflowRuns } from '../components/run/useWorkflowRuns.ts';
import { useStore } from '../stores/index.ts';
import {
  CONSOLIDATE_PIPELINES,
  flattenTree,
  formatRunTime,
  runTitle,
  type ConsolidatePipeline,
} from '../lib/consolidateModel.ts';

export default function ConsolidatePage() {
  const { wid } = useParams<{ wid: string }>();
  const [searchParams] = useSearchParams();
  const { treeNodes, loadTree, addToast } = useStore();
  const flatNodes = useMemo(() => flattenTree(treeNodes), [treeNodes]);
  const initialArticleId = searchParams.get('article') ?? '';
  const [articleId, setArticleId] = useState(initialArticleId);
  const [pipeline, setPipeline] = useState<ConsolidatePipeline>(initialArticleId ? 'cohere' : 'audit');
  const [contextDepth, setContextDepth] = useState<'shallow' | 'mid' | 'deep'>('mid');
  const [contextBasis, setContextBasis] = useState<'current' | 'latest_draft' | 'published'>('current');
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const {
    runs,
    selectedRunId,
    selectedRun,
    selectedRunLoading,
    setSelectedRunId,
    loadRuns,
  } = useWorkflowRuns({
    worldId: wid,
    graphType: 'consolidate',
    pollIntervalMs: 1500,
  });

  useEffect(() => {
    if (!wid) return;
    loadTree(wid).catch(console.error);
  }, [wid, loadTree]);

  useEffect(() => {
    if (!articleId && flatNodes[0]) setArticleId(flatNodes[0].id);
  }, [articleId, flatNodes]);

  const selectedPipeline = CONSOLIDATE_PIPELINES.find((item) => item.id === pipeline)!;
  const requiresArticle = selectedPipeline.scope === 'article';
  const canRun = wid && (!requiresArticle || articleId) && !busy;

  const startRun = async () => {
    if (!wid || !canRun) return;
    setBusy(true);
    try {
      const articleIds = selectedPipeline.scope === 'world' ? [] : articleId ? [articleId] : [];
      const run = await api.runs.create(wid, {
        graphType: 'consolidate',
        pipelineType: pipeline,
        articleIds,
        contextDepth,
        contextBasis,
      });
      setSelectedRunId(run.id);
      await loadRuns(true);
      addToast({ type: 'success', message: 'Consolidate run started.' });
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Unable to start Consolidate run.' });
    } finally {
      setBusy(false);
    }
  };

  if (!wid) return null;

  return (
    <WorkspaceLayout
      rightOpen={settingsOpen}
      left={
        <RunListSidebar
          title="Consolidate Runs"
          emptyText="No Consolidate runs yet."
          runs={runs}
          selectedRunId={selectedRunId}
          onRefresh={() => loadRuns().catch(console.error)}
          onSelectRun={(run) => setSelectedRunId(run.id)}
          getTitle={runTitle}
          getTimestamp={(run) => formatRunTime(run.createdAt)}
        />
      }
      center={
        <WorkflowCenter
          accentClass="text-blue-600"
          eyebrow="Selected Run"
          title={selectedRun ? runTitle(selectedRun) : 'No run selected'}
          subtitle="Run cleanup agents, then review their drafts, flags, and suggestions in Inbox."
          settingsOpen={settingsOpen}
          loading={selectedRunLoading}
          emptyTitle="No run selected"
          emptyText="Start a Consolidate run from the settings panel."
          onShowSettings={() => setSettingsOpen(true)}
        >
          {selectedRun ? (
              <>
                <RunDetailHeader
                  run={selectedRun}
                  title={runTitle(selectedRun)}
                  createdLabel={formatRunTime(selectedRun.createdAt)}
                  actions={
                  <Link to={`/worlds/${wid}/inbox`} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
                    Open Inbox
                  </Link>
                  }
                />

                <RunStatsGrid
                  stats={[
                    { label: 'Pipeline', value: String(selectedRun.config.pipelineType ?? 'consolidate').replace('_', ' ') },
                    { label: 'Progress', value: `${selectedRun.itemsCompleted} / ${selectedRun.itemsTotal}` },
                    { label: 'Tokens', value: selectedRun.budgetUsed.toLocaleString() },
                  ]}
                />

                <div className="grid grid-cols-[1fr_320px] gap-4 p-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold text-gray-700">Step History</p>
                    {selectedRun.events.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-400">No events yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedRun.events.map((event) => (
                          <div key={event.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-gray-800">{event.step}</p>
                              <LabelBadge label={event.ok ? 'ok' : 'failed'} colorClass={event.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} />
                            </div>
                            <p className="mt-1 text-xs text-gray-500">{event.title}{event.message ? ` · ${event.message}` : ''}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold text-gray-700">Agent Calls</p>
                    {selectedRun.agentCalls.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-400">No calls yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedRun.agentCalls.map((call) => (
                          <div key={call.id} className="rounded-lg border border-gray-100 bg-white p-3">
                            <p className="text-xs font-semibold text-gray-800">{call.agentType}</p>
                            <p className="mt-1 text-[10px] text-gray-400">{call.tokensIn ?? 0} in · {call.tokensOut ?? 0} out</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
          ) : null}
        </WorkflowCenter>
      }
      right={
        <>
          <WorkflowSettingsHeader
            icon={<ShieldCheck size={15} className="text-gray-500" />}
            title="New Consolidate Run"
            description="Improve existing material and send results to Inbox."
            onHide={() => setSettingsOpen(false)}
          />

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <SettingGroup title="Pipeline" defaultOpen>
              <div className="space-y-2">
                {CONSOLIDATE_PIPELINES.map((item) => {
                  const Icon = item.icon;
                  const active = pipeline === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setPipeline(item.id)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        active ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Icon size={15} className={active ? 'text-blue-700' : 'text-gray-400'} />
                        <div>
                          <p className={`text-xs font-semibold ${active ? 'text-blue-800' : 'text-gray-800'}`}>{item.label}</p>
                          <p className="mt-1 text-xs leading-relaxed text-gray-500">{item.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </SettingGroup>

            {selectedPipeline.scope !== 'world' && (
              <SettingGroup title="Target Article" defaultOpen>
                <select
                  value={articleId}
                  onChange={(event) => setArticleId(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {flatNodes.map((node) => (
                    <option key={node.id} value={node.id}>{node.title}</option>
                  ))}
                </select>
              </SettingGroup>
            )}

            <SettingGroup title="Context">
              <div className="grid grid-cols-3 gap-1.5">
                {(['shallow', 'mid', 'deep'] as const).map((depth) => (
                  <button
                    key={depth}
                    onClick={() => setContextDepth(depth)}
                    className={`rounded-md border py-1.5 text-xs ${contextDepth === depth ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {depth}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {([
                  { value: 'current' as const, label: 'Current' },
                  { value: 'latest_draft' as const, label: 'Drafts' },
                  { value: 'published' as const, label: 'Published' },
                ]).map((basis) => (
                  <button
                    key={basis.value}
                    onClick={() => setContextBasis(basis.value)}
                    className={`rounded-md border py-1.5 text-xs ${contextBasis === basis.value ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {basis.label}
                  </button>
                ))}
              </div>
            </SettingGroup>
          </div>

          <div className="border-t border-gray-100 p-4">
            <button
              onClick={startRun}
              disabled={!canRun}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={15} />
              {busy ? 'Starting...' : 'Start Consolidate Run'}
            </button>
          </div>
        </>
      }
    />
  );
}
