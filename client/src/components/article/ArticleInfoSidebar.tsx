import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import type { TreeNode } from '../../lib/tree.ts';
import { suggestedMetadataFields } from '../../lib/articleMetadataFields.ts';

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

function factValueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export default function ArticleInfoSidebar() {
  const { wid, aid } = useParams<{ wid: string; aid: string }>();
  const { currentArticleDetail, treeNodes, metadataFacts, metadataSuggestedFields, saveMetadataFacts } = useStore();

  const [editingDetails, setEditingDetails] = useState(false);
  const [draftFacts, setDraftFacts] = useState<{ key: string; value: string }[]>([]);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);

  if (!currentArticleDetail) return null;

  const { links, version, article } = currentArticleDetail;

  const flat = flattenTree(treeNodes);
  const currentNode = flat.find((n) => n.id === aid);
  const parentNode = currentNode?.parentId ? flat.find((n) => n.id === currentNode.parentId) : null;

  const children   = links.filter((l) => l.linkType === 'hierarchical');
  const references = links.filter((l) => l.linkType === 'references');

  const wordCount = version?.wordCount ?? 0;

  const suggestions = metadataSuggestedFields.length > 0
    ? metadataSuggestedFields
    : suggestedMetadataFields(article.templateType);
  const unusedSuggestions = suggestions.filter((s) => !metadataFacts.some((f) => f.key === s));

  function startEditingDetails() {
    setDraftFacts(metadataFacts.map((f) => ({ key: f.key, value: factValueToText(f.value) })));
    setNewKey('');
    setEditingDetails(true);
  }

  function updateDraftValue(key: string, value: string) {
    setDraftFacts((prev) => prev.map((f) => (f.key === key ? { ...f, value } : f)));
  }

  function removeDraftField(key: string) {
    setDraftFacts((prev) => prev.filter((f) => f.key !== key));
  }

  function addDraftField(key: string) {
    const trimmed = key.trim();
    if (!trimmed || draftFacts.some((f) => f.key === trimmed)) return;
    setDraftFacts((prev) => [...prev, { key: trimmed, value: '' }]);
    setNewKey('');
  }

  async function handleSave() {
    if (!wid || !aid) return;
    setSaving(true);
    try {
      await saveMetadataFacts(wid, aid, draftFacts.filter((f) => f.value.trim() !== ''));
      setEditingDetails(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="w-60 shrink-0 sticky top-8 flex flex-col gap-4 text-xs">

      {/* Parent */}
      {parentNode && (
        <div>
          <p className="font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Parent</p>
          <Link
            to={`/worlds/${wid}/articles/${parentNode.id}`}
            className="flex items-center gap-1 text-blue-600 hover:underline"
          >
            <span className="text-gray-400">←</span>
            <span className="truncate">{parentNode.title}</span>
          </Link>
        </div>
      )}

      {/* Children */}
      {children.length > 0 && (
        <div>
          <p className="font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Children ({children.length})
          </p>
          <ul className="flex flex-col gap-1">
            {children.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/worlds/${wid}/articles/${c.id}`}
                  className="text-blue-600 hover:underline truncate block"
                >
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* References */}
      {references.length > 0 && (
        <div>
          <p className="font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            References ({references.length})
          </p>
          <ul className="flex flex-col gap-1">
            {references.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/worlds/${wid}/articles/${r.id}`}
                  className="text-blue-600 hover:underline truncate block"
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Conceptual metadata — facts about the subject (infobox) */}
      <div className="border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between mb-1.5">
          <p className="font-semibold text-gray-400 uppercase tracking-wide">Details</p>
          {!editingDetails && (
            <button type="button" onClick={startEditingDetails} className="text-blue-600 hover:underline">
              {metadataFacts.length > 0 ? 'Edit' : 'Add'}
            </button>
          )}
        </div>

        {!editingDetails && metadataFacts.length === 0 && (
          <p className="text-gray-400 italic">No details yet.</p>
        )}

        {!editingDetails && metadataFacts.length > 0 && (
          <dl className="flex flex-col gap-1">
            {metadataFacts.map((f) => (
              <div key={f.id} className="flex justify-between gap-2">
                <dt className="text-gray-400 capitalize shrink-0">{f.key}</dt>
                <dd className="text-right truncate" title={factValueToText(f.value)}>{factValueToText(f.value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {editingDetails && (
          <div className="flex flex-col gap-2">
            <datalist id="metadata-field-suggestions">
              {unusedSuggestions.map((s) => <option key={s} value={s} />)}
            </datalist>

            {draftFacts.map((f) => (
              <div key={f.key} className="flex items-center gap-1">
                <span className="text-gray-400 capitalize w-16 shrink-0 truncate">{f.key}</span>
                <input
                  type="text"
                  value={f.value}
                  onChange={(e) => updateDraftValue(f.key, e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded px-1 py-0.5"
                />
                <button type="button" onClick={() => removeDraftField(f.key)} className="text-gray-400 hover:text-red-600 px-1">
                  ×
                </button>
              </div>
            ))}

            <div className="flex items-center gap-1">
              <input
                type="text"
                list="metadata-field-suggestions"
                placeholder="Add field..."
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraftField(newKey); } }}
                className="flex-1 min-w-0 border border-gray-200 rounded px-1 py-0.5"
              />
              <button type="button" onClick={() => addDraftField(newKey)} className="text-blue-600 px-1">+</button>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditingDetails(false)} className="text-gray-500 hover:underline">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="text-blue-600 hover:underline disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Document metadata — facts about the record itself, not the subject */}
      <div className="border-t border-gray-100 pt-3 flex flex-col gap-1 text-gray-500">
        <p className="font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Document</p>
        <div className="flex justify-between">
          <span className="text-gray-400">Status</span>
          <span className={`font-medium ${
            article.status === 'reviewed' ? 'text-green-600' :
            article.status === 'draft'    ? 'text-blue-600' :
                                            'text-gray-500'
          }`}>{article.status}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Type</span>
          <span>{article.templateType}</span>
        </div>
        {wordCount > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-400">Words</span>
            <span>{wordCount.toLocaleString()}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
