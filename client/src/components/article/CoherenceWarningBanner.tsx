import type { CoherenceWarning } from '../../types/article.ts';

interface Props {
  warnings: CoherenceWarning[];
  onDismiss?: (id: string) => void;
}

export default function CoherenceWarningBanner({ warnings, onDismiss }: Props) {
  if (warnings.length === 0) return null;

  return (
    <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="text-xs font-semibold text-amber-800 mb-1.5">Coherence warnings</p>
      <div className="flex flex-col gap-1">
        {warnings.map((w) => (
          <div key={w.id} className="flex items-start justify-between gap-2">
            <p className="text-xs text-amber-700">
              <span className={`font-medium ${w.severity === 'conflict' ? 'text-red-600' : 'text-amber-700'}`}>
                [{w.severity}]
              </span>{' '}
              {w.description}
            </p>
            {onDismiss && (
              <button
                onClick={() => onDismiss(w.id)}
                className="shrink-0 text-xs text-amber-400 hover:text-amber-600"
                title="Dismiss warning"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
