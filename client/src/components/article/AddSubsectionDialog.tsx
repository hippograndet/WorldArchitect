import { useEffect, useState } from 'react';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { TemplateType } from '../../types/article.ts';
import { ARTICLE_TYPES, type ArticleTypeDefinition } from '../../lib/articleTypes.ts';

interface Props {
  worldId: string;
  parentArticleId: string;
  onClose: () => void;
}

export default function AddSubsectionDialog({ worldId, parentArticleId, onClose }: Props) {
  const { loadTree, selectArticle, addToast } = useStore();

  const [title, setTitle]        = useState('');
  const [introduction, setIntro] = useState('');
  const [templateType, setTemplate] = useState<TemplateType>('general');
  const [articleTypes, setArticleTypes] = useState<ArticleTypeDefinition[]>(ARTICLE_TYPES);
  const [saving, setSaving]      = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.articleTypes.list(worldId)
      .then((res) => {
        if (!cancelled) setArticleTypes(res.articleTypes);
      })
      .catch(() => {
        if (!cancelled) setArticleTypes(ARTICLE_TYPES);
      });
    return () => { cancelled = true; };
  }, [worldId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await api.articles.batch(worldId, {
        parentArticleId,
        children: [{ title: title.trim(), introduction: introduction.trim(), templateType }],
      });
      await loadTree(worldId);
      await selectArticle(worldId, parentArticleId);
      addToast({ message: `"${title.trim()}" created.`, type: 'success' });
      onClose();
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/30"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-96 p-6 flex flex-col gap-5">
        <div>
          <h2 className="text-base font-bold text-gray-900">Add Subject</h2>
          <p className="text-xs text-gray-400 mt-0.5">Create a child subject under this article.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Subject title…"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Introduction <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={introduction}
              onChange={(e) => setIntro(e.target.value)}
              rows={2}
              placeholder="One sentence introducing this subject…"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <select
              value={templateType}
              onChange={(e) => setTemplate(e.target.value as TemplateType)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            >
              {articleTypes.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={!title.trim() || saving}
              className="flex-1 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-sm font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
