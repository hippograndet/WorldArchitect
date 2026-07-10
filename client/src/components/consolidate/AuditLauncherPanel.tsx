import { useEffect, useState } from 'react';
import { ExternalLink, PanelRightClose, Search, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import SettingGroup from '../shared/SettingGroup.tsx';
import type { EntityMention } from '../../types/world.ts';

interface Props {
  wid: string;
  onHide: () => void;
  preselectedArticleId?: string | null;
  mentions: EntityMention[];
  onChanged: () => void;
}

export default function AuditLauncherPanel({ wid, onHide, preselectedArticleId, mentions, onChanged }: Props) {
  const navigate = useNavigate();
  const { startAudit, dispatchSolidify, addToast } = useStore();
  const [articleTitle, setArticleTitle] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [mentionBusyId, setMentionBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!preselectedArticleId) {
      setArticleTitle(null);
      return;
    }
    let cancelled = false;
    api.articles.get(wid, preselectedArticleId)
      .then((detail) => { if (!cancelled) setArticleTitle(detail.article.title); })
      .catch(() => { if (!cancelled) setArticleTitle(preselectedArticleId); });
    return () => { cancelled = true; };
  }, [wid, preselectedArticleId]);

  const handleDispatch = (pipeline: 'cohere' | 'reorganize') => {
    if (!preselectedArticleId) return;
    dispatchSolidify(wid, preselectedArticleId, articleTitle ?? preselectedArticleId, pipeline);
  };

  const visibleMentions = mentions.filter((mention) => (
    mention.status === 'pending' || mention.status === 'created'
  ));
  const pendingCount = visibleMentions.filter((mention) => mention.status === 'pending').length;

  const handleScanConcepts = async () => {
    if (scanBusy) return;
    setScanBusy(true);
    try {
      const result = await api.entityMentions.scan(wid, preselectedArticleId ? { articleId: preselectedArticleId } : undefined);
      addToast({
        type: 'success',
        message: `Scanned ${result.scannedArticles} article${result.scannedArticles === 1 ? '' : 's'}; found ${result.created} candidate${result.created === 1 ? '' : 's'}.`,
      });
      onChanged();
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Concept scan failed.' });
    } finally {
      setScanBusy(false);
    }
  };

  const handleAcceptMention = async (mention: EntityMention) => {
    setMentionBusyId(mention.id);
    try {
      const updated = await api.entityMentions.accept(wid, mention.id);
      addToast({ type: 'success', message: `Created concept "${updated.title}".` });
      onChanged();
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Unable to create concept.' });
    } finally {
      setMentionBusyId(null);
    }
  };

  const handleIgnoreMention = async (mention: EntityMention) => {
    setMentionBusyId(mention.id);
    try {
      await api.entityMentions.ignore(wid, mention.id);
      onChanged();
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Unable to ignore concept.' });
    } finally {
      setMentionBusyId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings size={15} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Consolidation Tools</h2>
          </div>
          <button
            onClick={onHide}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
          >
            <PanelRightClose size={13} />
            Hide
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {preselectedArticleId && (
          <SettingGroup title="Solidify Article" defaultOpen>
            <p className="text-xs text-gray-500 leading-relaxed mb-1">Target article</p>
            <p className="text-sm font-medium text-gray-800 mb-3 truncate" title={articleTitle ?? preselectedArticleId}>
              {articleTitle ?? 'Loading…'}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleDispatch('reorganize')}
                className="w-full py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Reorganize
              </button>
              <button
                onClick={() => handleDispatch('cohere')}
                className="w-full py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Coherence Check
              </button>
            </div>
          </SettingGroup>
        )}

        <SettingGroup title="Auditor" defaultOpen>
          <p className="text-xs text-gray-500 leading-relaxed mb-3">
            Scans the full article graph for contradictions, gaps, and weak links, and suggests new cross-article
            connections. Results — including suggested links to accept or reject — appear in the panel that opens.
          </p>
          <button
            onClick={() => startAudit(wid)}
            className="w-full py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Run Audit
          </button>
        </SettingGroup>

        <SettingGroup title="Concepts" defaultOpen>
          <p className="text-xs text-gray-500 leading-relaxed mb-3">
            Scan accepted article prose for significant concepts that may deserve their own referenced documents.
          </p>
          <button
            onClick={handleScanConcepts}
            disabled={scanBusy}
            className="w-full py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <Search size={14} />
              {scanBusy ? 'Scanning…' : 'Scan Concepts'}
            </span>
          </button>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700">Candidates</p>
              {pendingCount > 0 && <span className="text-[11px] rounded-full bg-blue-100 px-1.5 py-0.5 text-blue-700">{pendingCount} pending</span>}
            </div>
            {visibleMentions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
                No concept candidates yet.
              </p>
            ) : (
              <div className="space-y-2">
                {visibleMentions.map((mention) => (
                  <div key={mention.id} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{mention.templateType}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-800" title={mention.title}>{mention.title}</p>
                        {mention.summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">{mention.summary}</p>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {mention.status === 'pending' ? (
                        <>
                          <button
                            onClick={() => handleAcceptMention(mention)}
                            disabled={mentionBusyId === mention.id}
                            className="rounded-md border border-blue-200 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                          >
                            Create/Link
                          </button>
                          <button
                            onClick={() => handleIgnoreMention(mention)}
                            disabled={mentionBusyId === mention.id}
                            className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Ignore
                          </button>
                        </>
                      ) : (
                        mention.articleId && (
                          <button
                            onClick={() => navigate(`/worlds/${wid}/articles/${mention.articleId}`)}
                            className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                          >
                            <ExternalLink size={11} />
                            Open
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SettingGroup>
      </div>
    </div>
  );
}
