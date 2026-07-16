import type { RunQueueItem } from '../../types/run.ts';

const STATUS_DOT: Record<RunQueueItem['status'], string> = {
  pending: 'bg-gray-300',
  active: 'bg-amber-400',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
};

const STATUS_LABEL: Record<RunQueueItem['status'], string> = {
  pending: 'To do',
  active: 'In progress',
  completed: 'Done',
  failed: 'Failed',
};

export default function RunQueueList({
  items,
  selectedArticleId,
  onSelect,
}: {
  items: RunQueueItem[];
  selectedArticleId: string | null;
  onSelect: (articleId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        Queue detail isn&apos;t available for runs started before this update.
      </p>
    );
  }

  return (
    <ol className="space-y-1">
      {items.map((item, index) => {
        const active = item.status === 'active';
        const selected = item.articleId === selectedArticleId;
        return (
          <li key={item.id}>
            <button
              onClick={() => onSelect(item.articleId)}
              style={{ marginLeft: `${Math.min(item.depth, 4) * 12}px` }}
              className={`w-full flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                selected
                  ? 'border-purple-300 bg-purple-50'
                  : active
                    ? 'border-amber-200 bg-amber-50 hover:bg-amber-100'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <span className="text-[10px] text-gray-400 w-4 shrink-0 text-right">{index + 1}</span>
              <span
                aria-label={STATUS_LABEL[item.status]}
                className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[item.status]}`}
              />
              <span className={`flex-1 truncate text-xs ${active ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                {item.title}
              </span>
              <span className="text-[10px] text-gray-400 shrink-0">{STATUS_LABEL[item.status]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
