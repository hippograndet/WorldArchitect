import { useStore } from '../../stores/index.ts';

function formatK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export default function WorldBibleMeter() {
  const { bibleTokenCount, bibleThreshold } = useStore();

  const pct = bibleThreshold > 0 ? Math.min(100, (bibleTokenCount / bibleThreshold) * 100) : 0;
  const color = pct < 60 ? 'bg-green-500' : pct < 85 ? 'bg-amber-500' : 'bg-red-500';
  const label = pct >= 85 ? 'bg-red-50 text-red-700' : pct >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700';

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs font-mono ${label}`} title={`Bible: ${bibleTokenCount} / ${bibleThreshold} tokens`}>
      <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span>{formatK(bibleTokenCount)}</span>
    </div>
  );
}
