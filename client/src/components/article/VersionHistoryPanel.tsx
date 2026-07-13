import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { ArticleVersion } from '../../types/article.ts';

interface Props {
  onClose: () => void;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString();
}

export default function VersionHistoryPanel({ onClose }: Props) {
  const { wid, aid } = useParams<{ wid: string; aid: string }>();
  const { versions, loadVersions, currentArticleDetail, addToast } = useStore();

  const [preview, setPreview]       = useState<ArticleVersion | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!wid || !aid) return;
    loadVersions(wid, aid).catch(console.error);
  }, [wid, aid, loadVersions]);

  const handlePreview = async (v: ArticleVersion) => {
    if (!wid || !aid) return;
    if (preview?.id === v.id) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const full = await api.articles.versions.get(wid, aid, v.id);
      setPreview(full);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const currentVersionId = currentArticleDetail?.article.currentVersionId;

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-white border-l border-gray-200 shadow-xl flex flex-col z-40">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900 text-sm">Version History</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No versions yet.</p>
        ) : (
          versions.map((v) => (
            <div
              key={v.id}
              className={`border-b border-gray-100 ${v.id === currentVersionId ? 'bg-blue-50' : ''}`}
            >
              <div className="flex items-center justify-between px-4 py-2.5 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">v{v.versionNumber}</span>
                    {v.isRevert && <span className="text-xs text-gray-400 italic">revert</span>}
                    {v.id === currentVersionId && <span className="text-xs text-blue-600 font-medium">current</span>}
                  </div>
                  <p className="text-xs text-gray-400">{timeAgo(v.createdAt)} · {v.wordCount} words</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handlePreview(v)}
                    disabled={previewLoading}
                    className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 text-gray-600"
                  >
                    {preview?.id === v.id ? 'Hide' : 'Preview'}
                  </button>
                </div>
              </div>

              {/* Inline preview */}
              {preview?.id === v.id && (
                <div className="px-4 pb-3">
                  <div className="text-xs text-gray-600 bg-gray-50 rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                    {preview.description || preview.introduction || <em className="text-gray-400">Empty</em>}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
