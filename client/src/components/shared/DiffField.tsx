import { diffWordsWithSpace } from 'diff';

export default function DiffField({ label, before, after }: { label: string; before: string; after: string }) {
  if (!after) return null;
  const parts = diffWordsWithSpace(before, after);
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-xs text-gray-800 whitespace-pre-wrap">
        {parts.map((part, i) => {
          if (part.added) {
            return <ins key={i} className="bg-green-200 text-green-900 no-underline">{part.value}</ins>;
          }
          if (part.removed) {
            return <del key={i} className="bg-red-200 text-red-900">{part.value}</del>;
          }
          return <span key={i}>{part.value}</span>;
        })}
      </p>
    </div>
  );
}
