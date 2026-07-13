import { useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import type { PendingDraft } from '../../types/article.ts';

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

export default function DraftBundlePanel({
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
