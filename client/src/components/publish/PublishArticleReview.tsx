import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { useStore } from '../../stores/index.ts';
import { draftPhase } from '../../lib/articleVersions.ts';
import DiffField from '../shared/DiffField.tsx';
import MarkdownSectionEditor, { type MarkdownSectionEditorHandle } from '../article/MarkdownSectionEditor.tsx';
import type { StagedArticle } from './PublishPanel.tsx';

interface PublishArticleReviewProps {
  wid: string;
  article: StagedArticle;
  onPublished: () => void;
  onClose: () => void;
}

export default function PublishArticleReview({ wid, article, onPublished, onClose }: PublishArticleReviewProps) {
  const { versions, loadVersions, commitManualEdit, acceptDraft, discardDraft, addToast } = useStore();
  const [compareVersionId, setCompareVersionId] = useState<string | null>(article.currentVersionId);
  const [introText, setIntroText] = useState('');
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [resolvingDraft, setResolvingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptionEditorRef = useRef<MarkdownSectionEditorHandle>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCompareVersionId(article.currentVersionId);
    loadVersions(wid, article.id).catch(() => {
      if (!cancelled) setError('Failed to load version history');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, article.id, article.currentVersionId]);

  const currentVersion = versions.find((v) => v.id === article.currentVersionId) ?? null;
  const compareVersion = versions.find((v) => v.id === compareVersionId) ?? null;
  const publishedVersion = versions.find((v) => v.id === article.publishedVersionId) ?? null;
  const issueCount = article.blockingIssues + article.warningIssues;

  useEffect(() => {
    if (currentVersion) setIntroText(currentVersion.introduction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVersion?.id]);

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const finalIntro = introText.trim();
      const finalDescription = descriptionEditorRef.current?.getMarkdown() ?? currentVersion?.description ?? '';
      const dirty = !!currentVersion && (finalIntro !== currentVersion.introduction || finalDescription !== currentVersion.description);
      if (dirty) {
        await commitManualEdit(wid, article.id, { introduction: finalIntro, description: finalDescription });
      }
      await api.publish.commit(wid, [article.id], true);
      onPublished();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleAcceptDraft = async () => {
    if (!article.pendingDraftId) return;
    setResolvingDraft(true);
    try {
      await acceptDraft(wid, article.id, article.pendingDraftId);
      addToast({ type: 'success', message: 'Draft accepted.' });
      onPublished();
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to accept draft.' });
    } finally {
      setResolvingDraft(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!article.pendingDraftId) return;
    setResolvingDraft(true);
    try {
      await discardDraft(wid, article.id, article.pendingDraftId);
      addToast({ type: 'success', message: 'Draft discarded.' });
      onPublished();
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to discard draft.' });
    } finally {
      setResolvingDraft(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  if (error && !currentVersion) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-red-600">
        <p>{error}</p>
        <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          Close
        </button>
      </div>
    );
  }

  if (!currentVersion) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-400">
        <p>No draft content to review yet.</p>
        <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{article.title}</h3>
          <select
            value={compareVersionId ?? ''}
            onChange={(e) => setCompareVersionId(e.target.value || null)}
            className="mt-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber} · {draftPhase(v, article.publishedVersionId)} · {new Date(v.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close review" title="Close review">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {article.pendingDraftId && (
          <div className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
            <span>There's also a newer AI-generated draft for this article awaiting review — the content below is the last accepted version, not that draft.</span>
            <button
              onClick={() => void handleAcceptDraft()}
              disabled={resolvingDraft}
              className="ml-auto shrink-0 font-medium text-green-700 hover:underline disabled:opacity-40"
            >
              Accept
            </button>
            <button
              onClick={() => void handleDiscardDraft()}
              disabled={resolvingDraft}
              className="shrink-0 font-medium text-gray-500 hover:underline disabled:opacity-40"
            >
              Discard
            </button>
          </div>
        )}

        {(issueCount > 0 || article.needsConsolidate) && (
          <div className={`space-y-1 rounded border p-3 text-xs ${article.blockingIssues > 0 ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {issueCount > 0 && (
              <p>
                <strong>{article.blockingIssues > 0 ? 'Heads up — ' : ''}</strong>
                {article.blockingIssues > 0 && `${article.blockingIssues} blocking `}
                {article.warningIssues > 0 && `${article.warningIssues} warning `}
                issue{issueCount !== 1 ? 's' : ''} still open —{' '}
                <a href={`/worlds/${wid}/inbox?article=${article.id}`} className="underline hover:no-underline">resolve in Flags</a>.
                You can still publish.
              </p>
            )}
            {article.needsConsolidate && <p>No coherence review since the last edit.</p>}
          </div>
        )}

        <div className="space-y-3 rounded-md border border-gray-100 bg-gray-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {article.publishedVersionId ? 'Changes since published' : 'Not published yet — nothing to compare against'}
          </p>
          {article.publishedVersionId && compareVersion && (
            <>
              <DiffField label="Introduction" before={publishedVersion?.introduction ?? ''} after={compareVersion.introduction} />
              <DiffField label="Description" before={publishedVersion?.description ?? ''} after={compareVersion.description} />
            </>
          )}
        </div>

        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Introduction</p>
          <textarea
            value={introText}
            onChange={(e) => setIntroText(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="One-paragraph introduction for this article…"
          />
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Description</p>
          <MarkdownSectionEditor ref={descriptionEditorRef} key={currentVersion.id} initialContent={currentVersion.description} />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3">
        <button onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button
          onClick={() => void handlePublish()}
          disabled={publishing}
          className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </div>
  );
}
