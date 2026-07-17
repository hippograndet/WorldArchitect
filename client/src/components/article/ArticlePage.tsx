import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Pencil, Settings } from 'lucide-react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { draftPhase } from '../../lib/articleVersions.ts';
import MarkdownSectionEditor, { type MarkdownSectionEditorHandle } from './MarkdownSectionEditor.tsx';
import AddSubsectionDialog from './AddSubsectionDialog.tsx';
import ArticleInfoSidebar from './ArticleInfoSidebar.tsx';
import ArticleIssuesButton from './ArticleIssuesButton.tsx';
import CoherenceWarningBanner from './CoherenceWarningBanner.tsx';
import SectionHeader from './SectionHeader.tsx';

export default function ArticlePage() {
  const { wid, aid } = useParams<{ wid: string; aid: string }>();
  const navigate = useNavigate();
  const {
    selectArticle, currentArticleDetail, currentArticleId,
    commitManualEdit, addToast,
    versions, loadVersions,
  } = useStore();

  const [isEditing, setIsEditing]     = useState(false);
  const [introText, setIntroText]     = useState('');
  const [savingEdit, setSavingEdit]   = useState(false);
  const [showAddSubsection, setShowAddSubsection] = useState(false);
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const descriptionEditorRef = useRef<MarkdownSectionEditorHandle>(null);

  useEffect(() => {
    if (!wid || !aid) return;
    setIsEditing(false);
    setViewVersionId(null);
    selectArticle(wid, aid).catch(console.error);
    loadVersions(wid, aid).catch(console.error);
  }, [wid, aid, selectArticle, loadVersions]);

  if (!currentArticleDetail || currentArticleId !== aid) {
    return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  }

  const { article, version, introduction, links, openWarnings } = currentArticleDetail;
  const description = version?.description ?? '';

  // The version selector is a pure viewer: pick a draft, see its content. No
  // separate "Current" entry — the latest draft in the stack IS current, so
  // it's just the top row here. No diff, no accept/discard — Edit always
  // acts on the latest draft regardless of what's being viewed.
  const selectedVersionId = viewVersionId ?? article.currentVersionId;
  const viewedVersion = selectedVersionId ? versions.find((v) => v.id === selectedVersionId) ?? null : null;
  const displayIntroduction = viewedVersion ? viewedVersion.introduction : introduction;
  const displayDescription = viewedVersion ? viewedVersion.description : description;

  const handleOpenForge = () => {
    if (!wid || !aid) return;
    const params = new URLSearchParams({ start: aid });
    if (selectedVersionId) params.set('version', selectedVersionId);
    navigate(`/worlds/${wid}/forge?${params.toString()}`);
  };

  const handleOpenSolidify = () => {
    if (!wid || !aid) return;
    navigate(`/worlds/${wid}/consolidate?article=${encodeURIComponent(aid)}`);
  };

  // ---------------------------------------------------------------------------
  // Edit handlers
  // ---------------------------------------------------------------------------

  const handleStartEdit = () => {
    setViewVersionId(null);
    setIntroText(introduction);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveArticle = async () => {
    if (!wid || !aid || savingEdit) return;
    setSavingEdit(true);
    try {
      await commitManualEdit(wid, aid, {
        introduction: introText.trim(),
        description: descriptionEditorRef.current?.getMarkdown() ?? description,
      });
      setIsEditing(false);
      addToast({ message: 'Saved.', type: 'success' });
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
          <select
            value={selectedVersionId ?? ''}
            onChange={(e) => setViewVersionId(e.target.value || null)}
            className="mt-1.5 text-xs border border-gray-300 rounded px-2 py-1 text-gray-600 bg-white"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber} · {draftPhase(v, article.publishedVersionId)} · {new Date(v.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
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
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleSaveArticle}
                  disabled={savingEdit}
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                >
                  {savingEdit ? 'Saving…' : 'Save'}
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
          </div>
          <div className="w-px h-5 bg-gray-200" />
          <div className="flex items-center gap-2">
            {wid && aid && <ArticleIssuesButton wid={wid} aid={aid} />}
            <button
              onClick={handleOpenSolidify}
              className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1"
            >
              <Settings size={14} /> Solidify
            </button>
            <button
              onClick={handleOpenForge}
              className="px-3 py-1.5 text-xs border rounded-lg font-medium transition-colors border-purple-300 text-purple-600 hover:bg-purple-50 flex items-center gap-1"
            >
              <ExternalLink size={14} /> Forge
            </button>
          </div>
        </div>
      </div>

      {/* Legacy coherence warnings (pre-v5 — shown if present) */}
      <CoherenceWarningBanner warnings={openWarnings} />

      {/* Introduction */}
      <section className="mb-8">
        <SectionHeader title="Introduction" />
        {isEditing ? (
          <textarea
            value={introText}
            onChange={(e) => setIntroText(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="One-paragraph introduction for this article…"
          />
        ) : displayIntroduction ? (
          <p className="text-gray-700 leading-relaxed">{displayIntroduction}</p>
        ) : (
          <p className="text-sm text-gray-400 italic">No introduction yet. Click Edit to write one.</p>
        )}
      </section>

      {/* Description */}
      <section className="mb-8">
        <SectionHeader title="Description" />
        {isEditing ? (
          <MarkdownSectionEditor
            ref={descriptionEditorRef}
            key={version?.id}
            initialContent={description}
          />
        ) : displayDescription ? (
          <div className="prose prose-gray max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
            {displayDescription}
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
