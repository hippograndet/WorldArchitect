import { useStore } from '../../stores/index.ts';

interface Props {
  worldId: string;
}

export default function DraftCrashRecovery({ worldId }: Props) {
  const { pendingDraft, agentPhase, loadDraftIntoPanel, discardDraft, addToast } = useStore();

  // Only show when there's a draft that wasn't opened by the current session
  if (!pendingDraft || agentPhase !== 'idle') return null;

  const handleReview = () => {
    loadDraftIntoPanel(pendingDraft);
  };

  const handleDiscard = async () => {
    try {
      await discardDraft(worldId, pendingDraft.articleId);
      addToast({ message: 'Draft discarded.', type: 'info' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
  };

  return (
    <div className="mb-5 p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-amber-800">Unsaved AI draft found</p>
        <p className="text-xs text-amber-600 mt-0.5">
          A previous AI session left a draft for this article.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={handleReview}
          className="px-2.5 py-1 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700"
        >
          Review
        </button>
        <button
          onClick={handleDiscard}
          className="px-2.5 py-1 text-xs text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
