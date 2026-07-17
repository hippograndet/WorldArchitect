import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { useStore } from '../../stores/index.ts';
import PublishArticleReview from './PublishArticleReview.tsx';

export type StagedArticle = {
  id: string;
  title: string;
  status: string;
  templateType: string;
  depth: number;
  blockingIssues: number;
  warningIssues: number;
  health: string;
  updatedAt: number;
  pendingDraftId: string | null;
  currentVersionId: string | null;
  publishedVersionId: string | null;
  needsConsolidate: boolean;
};

function HealthDot({ health }: { health: string }) {
  const color = health === 'blocking' ? 'bg-red-500' : health === 'warnings' ? 'bg-amber-400' : 'bg-green-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

interface PublishPanelProps {
  wid: string;
  onPublished?: () => void;
}

export default function PublishPanel({ wid, onPublished }: PublishPanelProps) {
  const { addToast } = useStore();
  const [staged, setStaged] = useState<StagedArticle[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishedCount, setPublishedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvingDraftId, setResolvingDraftId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const loadStaged = useCallback(async () => {
    try {
      const articles = await api.publish.staged(wid);
      setStaged(articles);
    } catch {
      setError('Failed to load articles');
    }
  }, [wid]);

  useEffect(() => { void loadStaged(); }, [loadStaged]);

  const selectableArticles = staged.filter(a => !a.pendingDraftId);

  // Keep the selection in sync with the live staged list: an article that
  // gains a pending draft (or drops out of the staged set entirely) on a
  // refresh must stop being submitted, even if it was selected before that.
  useEffect(() => {
    const selectableIds = new Set(selectableArticles.map(a => a.id));
    setSelected(prev => {
      const next = new Set([...prev].filter(id => selectableIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged]);

  const toggleAll = () => {
    if (selected.size === selectableArticles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableArticles.map(a => a.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectClean = () => {
    setSelected(new Set(selectableArticles.filter(a => a.health === 'clean').map(a => a.id)));
  };

  const acceptDraft = async (articleId: string, draftId: string) => {
    setResolvingDraftId(draftId);
    try {
      await api.articles.draft.acceptById(wid, articleId, draftId);
      addToast({ type: 'success', message: 'Draft accepted.' });
      await loadStaged();
      onPublished?.();
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to accept draft.' });
    } finally {
      setResolvingDraftId(null);
    }
  };

  const discardDraft = async (articleId: string, draftId: string) => {
    setResolvingDraftId(draftId);
    try {
      await api.articles.draft.discardById(wid, articleId, draftId);
      addToast({ type: 'success', message: 'Draft discarded.' });
      await loadStaged();
      onPublished?.();
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to discard draft.' });
    } finally {
      setResolvingDraftId(null);
    }
  };

  // Blocking issues are a heavy warning, not a hard gate -- the counts shown
  // per article (and summed below) already come straight from article_issues,
  // kept fresh automatically whenever content is committed. Publish is always
  // available; the server call always forces through since the UI already
  // surfaced the warning up front.
  const runPublish = async () => {
    if (selected.size === 0) return;
    setPublishing(true);
    setError(null);
    try {
      const result = await api.publish.commit(wid, [...selected], true);
      setPublishedCount(result.published.length);
      setSelected(new Set());
      await loadStaged();
      onPublished?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const selectedSummary = [...selected].reduce((acc, id) => {
    const article = staged.find(a => a.id === id);
    if (article) {
      acc.blocking += article.blockingIssues;
      acc.warnings += article.warningIssues;
    }
    return acc;
  }, { blocking: 0, warnings: 0 });

  const reviewingArticle = staged.find(a => a.id === reviewingId) ?? null;

  const handleArticlePublished = async () => {
    await loadStaged();
    setReviewingId(null);
    onPublished?.();
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: article list */}
      <div className="w-80 border-r border-gray-200 flex flex-col bg-white">
        <div className="p-3 border-b border-gray-100 flex items-center gap-2">
          <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
            {selected.size === selectableArticles.length ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-gray-300">·</span>
          <button onClick={selectClean} className="text-xs text-green-600 hover:underline">
            Select clean
          </button>
          <span className="ml-auto text-xs text-gray-400">{selected.size} selected</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {staged.length === 0 ? (
            <p className="p-4 text-xs text-gray-400">No draft articles to publish.</p>
          ) : (
            staged.map(article => (
              <div key={article.id} className={`px-4 py-2.5 border-b border-gray-50 ${reviewingId === article.id ? 'bg-blue-50' : ''}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(article.id)}
                    disabled={!!article.pendingDraftId}
                    onChange={() => toggleOne(article.id)}
                    className="mt-1 accent-blue-600 disabled:opacity-40"
                  />
                  <button onClick={() => setReviewingId(article.id)} className="flex-1 min-w-0 text-left hover:underline">
                    <div className="flex items-center gap-1.5">
                      <HealthDot health={article.health} />
                      <span className="text-xs font-medium text-gray-800 truncate">{article.title}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {article.templateType} · depth {article.depth}
                      {article.blockingIssues > 0 && (
                        <span className="ml-1 text-red-500">⛔ {article.blockingIssues}</span>
                      )}
                      {article.warningIssues > 0 && (
                        <span className="ml-1 text-amber-500">⚠ {article.warningIssues}</span>
                      )}
                      {article.needsConsolidate && (
                        <span className="ml-1 text-blue-500">◌ no coherence review</span>
                      )}
                    </div>
                  </button>
                </div>
                {article.pendingDraftId && (
                  <div className="mt-2 ml-6 flex items-center gap-2 rounded border border-blue-100 bg-blue-50 px-2 py-1.5">
                    <span className="text-[10px] text-blue-700">Pending draft awaiting review</span>
                    <button
                      onClick={() => void acceptDraft(article.id, article.pendingDraftId!)}
                      disabled={resolvingDraftId === article.pendingDraftId}
                      className="ml-auto text-[10px] font-medium text-green-700 hover:underline disabled:opacity-40"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => void discardDraft(article.id, article.pendingDraftId!)}
                      disabled={resolvingDraftId === article.pendingDraftId}
                      className="text-[10px] font-medium text-gray-500 hover:underline disabled:opacity-40"
                    >
                      Discard
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: single-article review, or bulk publish action */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {reviewingArticle ? (
          <PublishArticleReview
            wid={wid}
            article={reviewingArticle}
            onPublished={() => void handleArticlePublished()}
            onClose={() => setReviewingId(null)}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white p-4">
              <button
                onClick={() => void runPublish()}
                disabled={selected.size === 0 || publishing}
                className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {publishing ? 'Publishing…' : `Publish ${selected.size} article${selected.size !== 1 ? 's' : ''}`}
              </button>

              {error && <span className="text-xs text-red-600">{error}</span>}
              {publishedCount !== null && (
                <span className="text-xs text-green-600 font-medium">
                  Published {publishedCount} article{publishedCount !== 1 ? 's' : ''} successfully.
                </span>
              )}
            </div>

            {selected.size > 0 && (selectedSummary.blocking > 0 || selectedSummary.warnings > 0) && (
              <div className={`mx-4 mt-4 rounded border p-3 text-xs ${selectedSummary.blocking > 0 ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                <strong>{selectedSummary.blocking > 0 ? 'Heads up — ' : ''}</strong>
                {selectedSummary.blocking > 0 && `${selectedSummary.blocking} blocking `}
                {selectedSummary.warnings > 0 && `${selectedSummary.warnings} warning `}
                issue{(selectedSummary.blocking + selectedSummary.warnings) !== 1 ? 's' : ''} across the selected articles. You can still publish — resolve them in Flags first if you'd rather not.
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-sm text-gray-400 text-center pt-16">
                {selected.size === 0
                  ? 'Select articles to publish them together, or click an article to review and publish it individually.'
                  : 'Ready to publish. Issue counts above come straight from Flags — open an article for a closer look.'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
