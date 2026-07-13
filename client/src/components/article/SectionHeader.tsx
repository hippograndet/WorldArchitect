import { Pencil, Plus } from 'lucide-react';

export default function SectionHeader({
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
