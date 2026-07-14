import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Pencil, Settings } from 'lucide-react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import MarkdownSectionEditor, { type MarkdownSectionEditorHandle } from './MarkdownSectionEditor.tsx';
import VersionHistoryPanel from './VersionHistoryPanel.tsx';
import AddSubsectionDialog from './AddSubsectionDialog.tsx';
import ArticleInfoSidebar from './ArticleInfoSidebar.tsx';
import ArticleIssuesButton from './ArticleIssuesButton.tsx';
import CoherenceWarningBanner from './CoherenceWarningBanner.tsx';
import SectionHeader from './SectionHeader.tsx';
import DraftBundlePanel from './DraftBundlePanel.tsx';
import type { PendingDraft } from '../../types/article.ts';

export default function ArticlePage() {
  const { wid, aid } = useParams<{ wid: string; aid: string }>();
  const navigate = useNavigate();
  const {
    selectArticle, currentArticleDetail, currentArticleId,
    saveManualEdit, loadTree, addToast, checkDraft,
    drafts, acceptDraft, discardDraft, showConfirm,
  } = useStore();

  const [isEditing, setIsEditing]     = useState(false);
  const [introText, setIntroText]     = useState('');
  const [savingEdit, setSavingEdit]   = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAddSubsection, setShowAddSubsection] = useState(false);
  const descriptionEditorRef = useRef<MarkdownSectionEditorHandle>(null);

  useEffect(() => {
    if (!wid || !aid) return;
    setIsEditing(false);
    setShowHistory(false);
    selectArticle(wid, aid).catch(console.error);
    checkDraft(wid, aid).catch(console.error);
  }, [wid, aid, selectArticle, checkDraft]);

  if (!currentArticleDetail || currentArticleId !== aid) {
    return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  }

  const { article, version, introduction, links, openWarnings } = currentArticleDetail;
  const description = version?.description ?? '';

  const pendingManualDraft = drafts.find(
    (d) => d.pipelineType === 'manual_edit' && d.status === 'pending',
  );
  // saveManualEdit always carries the full {introduction, description} pair into
  // draftContent, even for a field the user didn't touch (see articleSlice.ts —
  // acceptDraft would otherwise wipe an omitted field to ''). So "present in
  // draftContent" doesn't mean "changed" — compare against the committed value
  // to find what's actually pending, for the badge and the edit-mode seed below.
  const draftIntro = pendingManualDraft?.draftContent?.introduction;
  const draftDescription = pendingManualDraft?.draftContent?.description;
  const pendingIntro = draftIntro !== undefined && draftIntro !== introduction ? draftIntro : undefined;
  const pendingDescription = draftDescription !== undefined && draftDescription !== description ? draftDescription : undefined;

  const handleOpenHistory = () => {
    setShowHistory(true);
  };

  const handleOpenExpand = () => {
    if (!wid || !aid) return;
    setShowHistory(false);
    navigate(`/worlds/${wid}/expand?start=${encodeURIComponent(aid)}`);
  };

  const doAcceptDraft = async (draft: PendingDraft) => {
    if (!wid || !aid) return;
    try {
      await acceptDraft(wid, aid, draft.id);
      await loadTree(wid);
      addToast({ message: 'Draft accepted.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
  };

  const handleAcceptDraft = (draft: PendingDraft) => {
    // First edit past a published version — the article stays on its published
    // version until this accept, so this is the one moment it's about to diverge.
    // Once diverged, publishedVersionId !== currentVersionId and this won't fire
    // again until the article is republished.
    if (article.publishedVersionId && article.publishedVersionId === article.currentVersionId) {
      showConfirm({
        title: 'Propose a new version?',
        message: 'This article is published. Accepting creates a new draft on top of it — the published version stays live until you publish again.',
        confirmLabel: 'Accept',
        variant: 'neutral',
        onConfirm: () => doAcceptDraft(draft),
      });
      return;
    }
    void doAcceptDraft(draft);
  };

  const handleDiscardDraft = async (draft: PendingDraft) => {
    if (!wid || !aid) return;
    try {
      await discardDraft(wid, aid, draft.id);
      addToast({ message: 'Draft discarded.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
  };

  const handleOpenSolidify = () => {
    if (!wid || !aid) return;
    navigate(`/worlds/${wid}/consolidate?article=${encodeURIComponent(aid)}`);
  };

  // ---------------------------------------------------------------------------
  // Edit handlers
  // ---------------------------------------------------------------------------

  const handleStartEdit = () => {
    setIntroText(pendingIntro ?? introduction);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveArticle = async () => {
    if (!wid || !aid || savingEdit) return;
    setSavingEdit(true);
    try {
      await saveManualEdit(wid, aid, {
        introduction: introText.trim(),
        description: descriptionEditorRef.current?.getMarkdown() ?? description,
      });
      setIsEditing(false);
      addToast({ message: 'Saved as a pending edit — accept it below to apply.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="max-w-screen-xl mx-auto py-8 px-6">
      <div className="flex gap-10 items-start">
      {/* ── Main content column ── */}
      <div className="flex-1 min-w-0 max-w-2xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{article.title}</h1>
          {article.lockedByRunId && (
            <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
              <span
                className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700"
                title="Locked by an in-progress automated run — manual edits are blocked until it finishes"
              >
                🔒 locked by run
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isEditing ? (
            <>
              <button
                onClick={handleSaveArticle}
                disabled={savingEdit}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                {savingEdit ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-500"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={handleStartEdit}
              className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 flex items-center gap-1"
            >
              <Pencil size={14} /> Edit
            </button>
          )}
          <button
            onClick={handleOpenHistory}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-500"
          >
            History
          </button>
          {wid && aid && <ArticleIssuesButton wid={wid} aid={aid} />}
          <button
            onClick={handleOpenSolidify}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1"
          >
            <Settings size={14} /> Solidify
          </button>
          <button
            onClick={handleOpenExpand}
            className="px-3 py-1.5 text-xs border rounded-lg font-medium transition-colors border-purple-300 text-purple-600 hover:bg-purple-50 flex items-center gap-1"
          >
            <ExternalLink size={14} /> Expand
          </button>
        </div>
      </div>

      {/* Legacy coherence warnings (pre-v5 — shown if present) */}
      <CoherenceWarningBanner warnings={openWarnings} />

      <DraftBundlePanel
        drafts={drafts}
        onAccept={handleAcceptDraft}
        onDiscard={handleDiscardDraft}
      />

      {/* Introduction */}
      <section className="mb-8">
        <SectionHeader title="Introduction" pending={pendingIntro !== undefined} />
        {isEditing ? (
          <textarea
            value={introText}
            onChange={(e) => setIntroText(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="One-paragraph introduction for this article…"
          />
        ) : introduction ? (
          <p className="text-gray-700 leading-relaxed">{introduction}</p>
        ) : (
          <p className="text-sm text-gray-400 italic">No introduction yet. Click Edit to write one.</p>
        )}
      </section>

      {/* Description */}
      <section className="mb-8">
        <SectionHeader title="Description" pending={pendingDescription !== undefined} />
        {isEditing ? (
          <MarkdownSectionEditor
            ref={descriptionEditorRef}
            key={version?.id}
            initialContent={pendingDescription ?? description}
          />
        ) : description ? (
          <div className="prose prose-gray max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
            {description}
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No description yet. Click Edit to write one.</p>
        )}
      </section>

      {/* Subjects (linked child articles) */}
      <section className="mb-8">
        <SectionHeader
          title="Subjects"
          onAdd={() => setShowAddSubsection(true)}
        />
        {links.length > 0 ? (
          <ul className="flex flex-col gap-4 pl-0 list-none">
            {links.map((l) => (
              <li key={l.id}>
                <Link
                  to={`/worlds/${wid ?? ''}/articles/${l.id}`}
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  {l.title}
                </Link>
                {l.introduction && (
                  <p className="mt-1 text-sm text-gray-600 leading-relaxed">{l.introduction}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400 italic">No child subjects yet. Click + to add one.</p>
        )}
      </section>

      {/* Panels */}
      {showHistory && <VersionHistoryPanel onClose={() => setShowHistory(false)} />}

      {/* Add subject dialog */}
      {showAddSubsection && wid && aid && (
        <AddSubsectionDialog
          worldId={wid}
          parentArticleId={aid}
          onClose={() => setShowAddSubsection(false)}
        />
      )}

      </div>{/* end main content column */}

      {/* ── Info sidebar ── */}
      <ArticleInfoSidebar />

      </div>{/* end flex row */}
    </div>
  );
}
