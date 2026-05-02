import { useState } from 'react';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';

interface CompressEntry {
  articleId: string;
  articleTitle: string;
  compressedSummary: string;
  tokensBefore: number;
  tokensAfter: number;
}

interface Props {
  worldId: string;
  onClose: () => void;
}

export default function BibleCompressorModal({ worldId, onClose }: Props) {
  const { articles, loadBibleMeta, addToast } = useStore();
  const [entries, setEntries] = useState<CompressEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [ran, setRan] = useState(false);

  const totalBefore = entries.reduce((s, e) => s + e.tokensBefore, 0);
  const totalAfter  = selected.size > 0
    ? entries.reduce((s, e) => s + (selected.has(e.articleId) ? e.tokensAfter : e.tokensBefore), 0)
    : entries.reduce((s, e) => s + e.tokensAfter, 0);

  const toggleAll = () => {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.articleId)));
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleRunPreview = async () => {
    setLoading(true);
    try {
      const result = await api.agents.compress(worldId);
      const titleMap = new Map(articles.map((a) => [a.id, a.title]));
      const merged: CompressEntry[] = result.entries.map((e) => ({
        ...e,
        articleTitle: titleMap.get(e.articleId) ?? e.articleId,
      }));
      setEntries(merged);
      setSelected(new Set(merged.map((e) => e.articleId)));
      setRan(true);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (applying || selected.size === 0) return;
    setApplying(true);
    try {
      const toApply = entries.filter((e) => selected.has(e.articleId));
      for (const e of toApply) {
        await api.bible.updateEntry(worldId, e.articleId, e.compressedSummary);
      }
      await loadBibleMeta(worldId);
      addToast({ message: `Compressed ${toApply.length} Bible entries.`, type: 'success' });
      onClose();
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/30"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Bible Compressor</h2>
            <p className="text-xs text-gray-400 mt-0.5">Preview and apply compressed article summaries.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {!ran ? (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <p className="text-sm text-gray-500 text-center max-w-sm">
                Run compression to see a preview of condensed summaries. No changes are saved until you apply.
              </p>
              <button
                onClick={handleRunPreview}
                disabled={loading}
                className="px-5 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {loading ? 'Running…' : 'Run Compression Preview'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Summary stats */}
              <div className="flex items-center gap-6 p-3 bg-gray-50 rounded-xl text-xs">
                <span className="text-gray-500">Before: <strong>{totalBefore.toLocaleString()} tokens</strong></span>
                <span className="text-gray-400">→</span>
                <span className="text-gray-500">After: <strong>{totalAfter.toLocaleString()} tokens</strong></span>
                <span className={`font-semibold ${totalAfter < totalBefore ? 'text-green-600' : 'text-gray-500'}`}>
                  ({totalAfter < totalBefore ? '−' : '+'}{Math.abs(totalBefore - totalAfter).toLocaleString()})
                </span>
              </div>

              {/* Select all */}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={selected.size === entries.length}
                  onChange={toggleAll}
                  className="accent-purple-600"
                />
                <span>Select all ({selected.size}/{entries.length})</span>
              </div>

              {/* Entries */}
              <div className="flex flex-col gap-3">
                {entries.map((e) => (
                  <label
                    key={e.articleId}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${
                      selected.has(e.articleId) ? 'border-purple-300 bg-purple-50' : 'border-gray-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(e.articleId)}
                      onChange={() => toggle(e.articleId)}
                      className="mt-0.5 accent-purple-600 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs font-semibold text-gray-800 truncate">{e.articleTitle}</p>
                        <span className="text-xs text-green-600 shrink-0">
                          {e.tokensBefore} → {e.tokensAfter} tokens
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">{e.compressedSummary}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {ran && (
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applying || selected.size === 0}
              className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40"
            >
              {applying ? 'Applying…' : `Apply ${selected.size} Selected`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
