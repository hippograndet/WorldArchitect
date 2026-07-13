import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, RefreshCw, Send, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import WorkspaceLayout from '../components/shared/WorkspaceLayout.tsx';
import LabelBadge from '../components/shared/LabelBadge.tsx';
import type { InboxItem, InboxLane } from '../types/inbox.ts';
import { useStore } from '../stores/index.ts';
import {
  INBOX_LANES,
  INBOX_LANE_LABEL,
  INBOX_SEVERITY_COLOR,
  INBOX_STATUS_COLOR,
  laneIcon,
  payloadNumber,
  payloadString,
  relativeTime,
} from '../lib/inboxModel.ts';

export default function InboxPage() {
  const { wid } = useParams<{ wid: string }>();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selectedLane, setSelectedLane] = useState<InboxLane>('drafts');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { addToast, loadTree } = useStore();

  const loadInbox = useCallback(async () => {
    if (!wid) return;
    setLoading(true);
    try {
      const res = await api.inbox.list(wid);
      setItems(res.items);
      setSelectedId((current) => current && res.items.some((item) => item.id === current) ? current : null);
    } finally {
      setLoading(false);
    }
  }, [wid]);

  useEffect(() => {
    loadInbox().catch(console.error);
  }, [loadInbox]);

  const counts = useMemo(() => {
    const out = new Map<InboxLane, number>();
    for (const item of items) out.set(item.lane, (out.get(item.lane) ?? 0) + 1);
    return out;
  }, [items]);

  const laneItems = useMemo(
    () => items.filter((item) => item.lane === selectedLane),
    [items, selectedLane],
  );
  const selectedItem = items.find((item) => item.id === selectedId) ?? laneItems[0] ?? null;

  useEffect(() => {
    if (!selectedId && laneItems[0]) setSelectedId(laneItems[0].id);
  }, [laneItems, selectedId]);

  async function runAction(item: InboxItem, action: () => Promise<unknown>, success: string) {
    setBusyId(item.id);
    try {
      await action();
      addToast({ type: 'success', message: success });
      await loadInbox();
      if (wid) await loadTree(wid).catch(console.error);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Inbox action failed.' });
    } finally {
      setBusyId(null);
    }
  }

  if (!wid) return null;

  const renderActions = (item: InboxItem) => {
    const articleId = item.articleIds[0];
    const draftId = payloadString(item, 'draftId');
    const isBusy = busyId === item.id;

    if (item.lane === 'drafts' && articleId && draftId) {
      return (
        <>
          <button
            disabled={isBusy}
            onClick={() => runAction(item, () => api.articles.draft.acceptById(wid, articleId, draftId), 'Draft accepted.')}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Check size={13} /> Accept
          </button>
          <button
            disabled={isBusy}
            onClick={() => runAction(item, () => api.articles.draft.discardById(wid, articleId, draftId), 'Draft discarded.')}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <X size={13} /> Discard
          </button>
        </>
      );
    }

    if (item.lane === 'publish') {
      return (
        <Link to={`/worlds/${wid}/publish`} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
          <Send size={13} /> Open Publish
        </Link>
      );
    }

    if (item.kind === 'article_issue' && articleId) {
      return (
        <>
          <button
            disabled={isBusy}
            onClick={() => runAction(item, () => api.issues.updateStatus(wid, articleId, item.id, 'dismissed'), 'Flag dismissed.')}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <X size={13} /> Dismiss
          </button>
          <Link to={`/worlds/${wid}/articles/${articleId}`} className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
            <ExternalLink size={13} /> Open Article
          </Link>
        </>
      );
    }

    if (item.kind === 'world_issue') {
      return (
        <button
          disabled={isBusy}
          onClick={() => runAction(item, () => api.worldIssues.update(wid, item.id, 'dismissed'), 'World flag dismissed.')}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <X size={13} /> Dismiss
        </button>
      );
    }

    if (item.kind === 'edge_proposal') {
      const sourceArticleId = payloadString(item, 'sourceArticleId');
      const targetArticleId = payloadString(item, 'targetArticleId');
      const linkType = payloadString(item, 'linkType') === 'hierarchical' ? 'hierarchical' : 'references';
      if (!sourceArticleId || !targetArticleId) return null;
      return (
        <button
          disabled={isBusy}
          onClick={() => runAction(item, () => api.agents.acceptEdge(wid, { sourceArticleId, targetArticleId, linkType }), 'Suggested link accepted.')}
          className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Check size={13} /> Accept Link
        </button>
      );
    }

    if (item.kind === 'entity_mention') {
      return (
        <>
          <button
            disabled={isBusy}
            onClick={() => runAction(item, () => api.entityMentions.accept(wid, item.id), 'Concept created or linked.')}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Check size={13} /> Create/Link
          </button>
          <button
            disabled={isBusy}
            onClick={() => runAction(item, () => api.entityMentions.ignore(wid, item.id), 'Concept ignored.')}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <X size={13} /> Ignore
          </button>
        </>
      );
    }

    if (item.lane === 'run_checkpoints') {
      const runId = payloadString(item, 'runId');
      const graphType = payloadString(item, 'graphType');
      const target = graphType === 'consolidate' ? 'consolidate' : 'grow';
      return runId ? (
        <Link to={`/worlds/${wid}/${target}`} className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
          <ExternalLink size={13} /> Open Run
        </Link>
      ) : null;
    }

    return articleId ? (
      <Link to={`/worlds/${wid}/articles/${articleId}`} className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
        <ExternalLink size={13} /> Open
      </Link>
    ) : null;
  };

  return (
    <WorkspaceLayout
      rightOpen={false}
      left={
        <div className="flex h-full flex-col">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-sm font-semibold text-gray-900">Inbox</h1>
              <button
                onClick={() => loadInbox().catch(console.error)}
                disabled={loading}
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                aria-label="Refresh inbox"
                title="Refresh inbox"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
          <div className="space-y-1 p-3">
            {INBOX_LANES.map((lane) => {
              const active = lane.id === selectedLane;
              const Icon = laneIcon(lane.id);
              return (
                <button
                  key={lane.id}
                  onClick={() => { setSelectedLane(lane.id); setSelectedId(null); }}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                    active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Icon size={14} />
                  <span className="flex-1">{lane.label}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-500'}`}>
                    {counts.get(lane.id) ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      }
      center={
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{INBOX_LANE_LABEL[selectedLane]}</p>
              <h2 className="mt-1 text-2xl font-bold text-gray-900">Review Queue</h2>
              <p className="mt-1 text-sm text-gray-500">High-signal decisions and results from Grow, Consolidate, and Publish.</p>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(260px,360px)_1fr] overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="max-h-[680px] overflow-y-auto border-r border-gray-100">
              {loading ? (
                <p className="p-4 text-sm text-gray-400">Loading...</p>
              ) : laneItems.length === 0 ? (
                <p className="p-4 text-sm text-gray-400">Nothing in this lane.</p>
              ) : (
                laneItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`block w-full border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                      selectedItem?.id === item.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {item.severity && <span className={`mt-1 h-2 w-2 rounded-full ${item.severity === 'blocking' || item.severity === 'conflict' ? 'bg-red-500' : 'bg-amber-400'}`} />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900" title={item.title}>{item.title}</p>
                        <p className="mt-1 text-xs text-gray-400">{item.source} · {relativeTime(item.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="min-h-[520px] p-6">
              {!selectedItem ? (
                <p className="text-sm text-gray-400">Select an item to review.</p>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <LabelBadge label={INBOX_LANE_LABEL[selectedItem.lane]} colorClass="bg-gray-100 text-gray-700" />
                    <LabelBadge label={selectedItem.status.replace('_', ' ')} colorClass={INBOX_STATUS_COLOR[selectedItem.status] ?? 'bg-gray-100 text-gray-600'} />
                    {selectedItem.severity && <LabelBadge label={selectedItem.severity} colorClass={INBOX_SEVERITY_COLOR[selectedItem.severity] ?? 'bg-gray-100 text-gray-600'} />}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900">{selectedItem.title}</h3>
                    <p className="mt-1 text-xs text-gray-400">{selectedItem.kind} · {relativeTime(selectedItem.createdAt)}</p>
                  </div>

                  {selectedItem.articleIds.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedItem.articleIds.map((articleId) => (
                        <Link key={articleId} to={`/worlds/${wid}/articles/${articleId}`} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">
                          {articleId === payloadString(selectedItem, 'articleId') && payloadString(selectedItem, 'articleTitle')
                            ? payloadString(selectedItem, 'articleTitle')
                            : articleId}
                        </Link>
                      ))}
                    </div>
                  )}

                  {selectedItem.kind === 'article_issue' && payloadString(selectedItem, 'excerpt') && (
                    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600">
                      {payloadString(selectedItem, 'excerpt')}
                    </div>
                  )}
                  {selectedItem.kind === 'edge_proposal' && payloadString(selectedItem, 'rationale') && (
                    <p className="text-sm leading-relaxed text-gray-700">{payloadString(selectedItem, 'rationale')}</p>
                  )}
                  {selectedItem.kind === 'entity_mention' && payloadString(selectedItem, 'summary') && (
                    <p className="text-sm leading-relaxed text-gray-700">{payloadString(selectedItem, 'summary')}</p>
                  )}
                  {selectedItem.lane === 'publish' && (
                    <p className="text-sm text-gray-600">
                      {payloadNumber(selectedItem, 'blockingIssues')} blocking issue(s), {payloadNumber(selectedItem, 'warningIssues')} warning(s).
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                    {renderActions(selectedItem)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      }
      right={null}
    />
  );
}
