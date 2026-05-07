import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../stores/index.ts';
import BibleCompressorModal from '../components/bible/BibleCompressorModal.tsx';
import type { ArticleStatus } from '../types/article.ts';

export default function WorldOverviewPage() {
  const { wid } = useParams<{ wid: string }>();
  const navigate = useNavigate();
  const {
    worlds, treeNodes, bibleTokenCount, bibleThreshold,
    startAudit, agentPanelOpen,
  } = useStore();

  const world = worlds.find((w) => w.id === wid);

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  const totalArticles = treeNodes.length;

  function countByStatus(status: ArticleStatus) {
    const count = (nodes: typeof treeNodes): number =>
      nodes.reduce((sum, n) => sum + (n.status === status ? 1 : 0) + count(n.children), 0);
    return count(treeNodes);
  }
  const stubs    = countByStatus('stub');
  const drafts   = countByStatus('draft');
  const reviewed = countByStatus('reviewed');

  const biblePercent = bibleThreshold > 0
    ? Math.min(100, Math.round((bibleTokenCount / bibleThreshold) * 100))
    : 0;

  const [showCompressor, setShowCompressor] = useState(false);

  const handleAudit = () => {
    if (!wid) return;
    startAudit(wid).catch(console.error);
  };

  const handleBrowse = () => {
    if (!wid || treeNodes.length === 0) return;
    navigate(`/worlds/${wid}/articles/${treeNodes[0].id}`);
  };

  if (!world) {
    return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-6">
      {/* World header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{world.name}</h1>
          <p className="text-xs text-gray-500 mb-2">{world.tone}</p>
          {world.description && (
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{world.description}</p>
          )}
        </div>
        {treeNodes.length > 0 && (
          <button
            onClick={handleBrowse}
            className="shrink-0 px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 whitespace-nowrap"
          >
            Browse Articles →
          </button>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {([
          { label: 'Total',    value: totalArticles, color: 'text-gray-900' },
          { label: 'Stubs',    value: stubs,         color: 'text-gray-500' },
          { label: 'Drafts',   value: drafts,        color: 'text-blue-600' },
          { label: 'Reviewed', value: reviewed,      color: 'text-green-600' },
        ] as { label: string; value: number; color: string }[]).map((s) => (
          <div key={s.label} className="border border-gray-200 rounded-lg p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* World Bible meter */}
      <div className="border border-gray-200 rounded-lg p-4 mb-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-700">World Bible</p>
          <p className="text-xs text-gray-400">
            ~{(bibleTokenCount / 1000).toFixed(1)}k tokens · {biblePercent}% of threshold
          </p>
        </div>
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              biblePercent >= 90 ? 'bg-red-400' :
              biblePercent >= 70 ? 'bg-amber-400' :
              'bg-purple-400'
            }`}
            style={{ width: `${biblePercent}%` }}
          />
        </div>
      </div>

      {/* World Tools */}
      <section>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">World Tools</h2>
        <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-200">
          <button
            onClick={handleAudit}
            disabled={agentPanelOpen}
            className="w-full flex items-start gap-4 p-4 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
          >
            <span className="text-xl leading-none mt-0.5">🔍</span>
            <div>
              <p className="text-sm font-semibold text-gray-800">Audit World</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Scan the full article graph for missing links and cross-article contradictions.
              </p>
            </div>
          </button>
          <button
            onClick={() => setShowCompressor(true)}
            className="w-full flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors text-left"
          >
            <span className="text-xl leading-none mt-0.5">📦</span>
            <div>
              <p className="text-sm font-semibold text-gray-800">Compress Bible</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Preview and apply AI-compressed summaries to reduce World Bible token usage.
              </p>
            </div>
          </button>
        </div>
      </section>

      {showCompressor && wid && (
        <BibleCompressorModal worldId={wid} onClose={() => setShowCompressor(false)} />
      )}
    </div>
  );
}
