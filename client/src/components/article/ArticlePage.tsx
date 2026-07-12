import { useEffect, useState } from 'react';
import { Check, ExternalLink, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import InlineDescriptionEditor from './InlineDescriptionEditor.tsx';
import ChronologyEditor from './ChronologyEditor.tsx';
import VersionHistoryPanel from './VersionHistoryPanel.tsx';
import AddSubsectionDialog from './AddSubsectionDialog.tsx';
import ArticleInfoSidebar from './ArticleInfoSidebar.tsx';
import ArticleIssuesPanel from './ArticleIssuesPanel.tsx';
import type { PendingDraft } from '../../types/article.ts';

function SectionHeader({
  title,
  onEdit,
  onAdd,
}: {
  title: string;
  onEdit?: () => void;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-200 pb-1 mb-3">
      <h2 className="text-base font-semibold text-gray-800 flex-1">{title}</h2>
      {onAdd && (
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
          title={`Add to ${title}`}
        >
          <Plus size={14} />
        </button>
      )}
      {onEdit && (
        <button
          onClick={onEdit}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
          title={`Edit ${title}`}
        >
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type EditingSection = 'introduction' | 'description' | 'chronology' | null;

function draftLabel(draft: PendingDraft): string {
  return draft.displayTitle ?? draft.runType ?? draft.pipelineType;
}

function draftSections(draft: PendingDraft): string {
  const content = draft.draftContent ?? {};
  const sections = [
    content.introduction ? 'intro' : null,
    content.description || content.childDescription ? 'description' : null,
    draft.parentUpdate ? 'parent update' : null,
    content.coherenceWarnings?.length ? 'warnings' : null,
    content.retentionIssues?.length ? 'retention' : null,
  ].filter(Boolean);
  return sections.length > 0 ? sections.join(', ') : 'metadata only';
}

function DraftBundlePanel({
  drafts,
  onReview,
  onAccept,
  onDiscard,
}: {
  drafts: PendingDraft[];
  onReview: (draft: PendingDraft) => void;
  onAccept: (draft: PendingDraft) => void;
  onDiscard: (draft: PendingDraft) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const pending = drafts.filter((draft) => draft.status === 'pending');
  const history = drafts.filter((draft) => draft.status !== 'pending');
  if (drafts.length === 0) return null;

  const renderDraft = (draft: PendingDraft, isHistory = false) => (
    <div key={draft.id} className="border border-amber-200 bg-amber-50 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber-900">{draftLabel(draft)}</p>
          <p className="text-xs text-amber-700 mt-0.5">
            {draft.status} · {draft.contextBasis.replace('_', ' ')} context · {draftSections(draft)}
          </p>
          <p className="text-[11px] text-amber-600 mt-1">
            {new Date(draft.createdAt).toLocaleString()}
            {draft.resolvedAt ? ` · resolved ${new Date(draft.resolvedAt).toLocaleString()}` : ''}
          </p>
        </div>
        {!isHistory && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onReview(draft)} className="px-2 py-1 text-xs border border-amber-300 rounded text-amber-800 hover:bg-amber-100">
              Review
            </button>
            <button onClick={() => onAccept(draft)} className="p-1.5 text-green-700 hover:bg-green-50 rounded" title="Accept draft">
              <Check size={14} />
            </button>
            <button onClick={() => onDiscard(draft)} className="p-1.5 text-red-700 hover:bg-red-50 rounded" title="Discard draft">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-800">Draft Bundles</h2>
        {history.length > 0 && (
          <button onClick={() => setShowHistory((v) => !v)} className="text-xs text-gray-500 hover:text-gray-700">
            {showHistory ? 'Hide' : 'Show'} history ({history.length})
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {pending.map((draft) => renderDraft(draft))}
        {pending.length === 0 && <p className="text-xs text-gray-400 italic">No pending draft bundles.</p>}
        {showHistory && history.map((draft) => renderDraft(draft, true))}
      </div>
    </section>
  );
}

export default function ArticlePage() {
  const { wid, aid } = useParams<{ wid: string; aid: string }>();
  const navigate = useNavigate();
  const {
    selectArticle, currentArticleDetail, currentArticleId,
    manualEdit, loadTree, addToast, checkDraft, loadMetadataFacts,
    drafts, acceptDraft, discardDraft, loadDraftIntoPanel,
  } = useStore();

  const [editingSection, setEditingSection] = useState<EditingSection>(null);
  const [introText, setIntroText]           = useState('');
  const [savingIntro, setSavingIntro]       = useState(false);
  const [showHistory, setShowHistory]       = useState(false);
  const [showAddSubsection, setShowAddSubsection] = useState(false);

  useEffect(() => {
    if (!wid || !aid) return;
    setEditingSection(null);
    setShowHistory(false);
    selectArticle(wid, aid).catch(console.error);
    checkDraft(wid, aid).catch(console.error);
    loadMetadataFacts(wid, aid).catch(console.error);
  }, [wid, aid, selectArticle, checkDraft, loadMetadataFacts]);

  if (!currentArticleDetail || currentArticleId !== aid) {
    return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  }

  const { article, version, introduction, links, openWarnings } = currentArticleDetail;
  const description = version?.description ?? '';
  const chronology  = version?.chronology  ?? '';

  const handleOpenHistory = () => {
    setShowHistory(true);
  };

  const handleOpenExpand = () => {
    if (!wid || !aid) return;
    setShowHistory(false);
    navigate(`/worlds/${wid}/expand?start=${encodeURIComponent(aid)}`);
  };

  const handleReviewDraft = (draft: PendingDraft) => {
    loadDraftIntoPanel(draft);
  };

  const handleAcceptDraft = async (draft: PendingDraft) => {
    if (!wid || !aid) return;
    try {
      await acceptDraft(wid, aid, draft.id);
      await loadTree(wid);
      addToast({ message: 'Draft accepted.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
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
  // Save handlers
  // ---------------------------------------------------------------------------

  const handleSaveDescription = async (newMarkdown: string) => {
    if (!wid || !aid) return;
    try {
      await manualEdit(wid, aid, { description: newMarkdown });
      setEditingSection(null);
      if (wid) loadTree(wid).catch(console.error);
      addToast({ message: 'Description saved.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
  };

  const handleSaveChronology = async (newMarkdown: string) => {
    if (!wid || !aid) return;
    try {
      await manualEdit(wid, aid, { chronology: newMarkdown });
      setEditingSection(null);
      addToast({ message: 'Chronology saved.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
  };

  const handleSaveIntro = async () => {
    if (!wid || !aid || savingIntro) return;
    setSavingIntro(true);
    try {
      await api.bible.updateEntry(wid, aid, introText.trim());
      await selectArticle(wid, aid);
      setEditingSection(null);
      addToast({ message: 'Introduction saved.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSavingIntro(false);
    }
  };

  const startEditIntro = () => {
    setIntroText(introduction);
    setEditingSection('introduction');
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
          <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
              article.status === 'reviewed' ? 'bg-green-100 text-green-700' :
              article.status === 'draft'    ? 'bg-blue-100 text-blue-700' :
                                              'bg-gray-100 text-gray-500'
            }`}>{article.status}</span>
            {article.lockedByRunId && (
              <span
                className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700"
                title="Locked by an in-progress automated run — manual edits are blocked until it finishes"
              >
                🔒 locked by run
              </span>
            )}
            <span>{article.templateType}</span>
            {article.temporalAnchorStart && (
              <span>{article.temporalAnchorEnd
                ? `${article.temporalAnchorStart} – ${article.temporalAnchorEnd}`
                : article.temporalAnchorStart}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleOpenHistory}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-500"
          >
            History
          </button>
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
      {openWarnings.length > 0 && (
        <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs font-semibold text-amber-800 mb-1">Coherence warnings</p>
          {openWarnings.map((w) => (
            <p key={w.id} className="text-xs text-amber-700">• {w.description}</p>
          ))}
        </div>
      )}

      <DraftBundlePanel
        drafts={drafts}
        onReview={handleReviewDraft}
        onAccept={handleAcceptDraft}
        onDiscard={handleDiscardDraft}
      />

      {/* Introduction */}
      <section className="mb-8">
        <SectionHeader title="Introduction" onEdit={startEditIntro} />
        {editingSection === 'introduction' ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={introText}
              onChange={(e) => setIntroText(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="One-paragraph introduction for this article…"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveIntro}
                disabled={savingIntro}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                {savingIntro ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditingSection(null)} className="text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            </div>
          </div>
        ) : introduction ? (
          <p className="text-gray-700 leading-relaxed">{introduction}</p>
        ) : (
          <p className="text-sm text-gray-400 italic">No introduction yet. Click ✏ to write one.</p>
        )}
      </section>

      {/* Description */}
      <section className="mb-8">
        <SectionHeader
          title="Description"
          onEdit={() => setEditingSection(editingSection === 'description' ? null : 'description')}
        />
        {editingSection === 'description' ? (
          <InlineDescriptionEditor
            key={version?.id}
            initialContent={description}
            onSave={handleSaveDescription}
            onCancel={() => setEditingSection(null)}
          />
        ) : description ? (
          <div className="prose prose-gray max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
            {description}
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No description yet. Click ✏ to write one.</p>
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

      {/* Chronology */}
      <section className="mb-8">
        <SectionHeader
          title="Chronology"
          onEdit={() => setEditingSection(editingSection === 'chronology' ? null : 'chronology')}
        />
        {editingSection === 'chronology' ? (
          <ChronologyEditor
            key={version?.id}
            initialContent={chronology}
            onSave={handleSaveChronology}
            onCancel={() => setEditingSection(null)}
          />
        ) : chronology ? (
          <div className="text-gray-700 leading-relaxed whitespace-pre-wrap text-sm">{chronology}</div>
        ) : (
          <p className="text-sm text-gray-400 italic">No chronology yet. Click ✏ to write one.</p>
        )}
      </section>

      {/* Article issues + world notes */}
      {wid && aid && (
        <ArticleIssuesPanel wid={wid} aid={aid} onArticleUpdated={() => selectArticle(wid, aid)} />
      )}

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

      {/* Expand FAB */}
      {wid && aid && (
        <button
          onClick={handleOpenExpand}
          className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-purple-600 text-white
                     shadow-xl hover:bg-purple-700 hover:scale-105 transition-all z-40
                     flex items-center justify-center text-xl font-bold select-none"
          title="Expand from this article"
        >
          <ExternalLink size={22} />
        </button>
      )}
    </div>
  );
}
