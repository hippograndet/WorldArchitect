import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, X, Plus } from 'lucide-react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { TreeNode } from '../../lib/tree.ts';
import type { ArticleStatus } from '../../types/article.ts';

const statusDot: Record<string, string> = {
  stub:     'bg-gray-300',
  draft:    'bg-blue-400',
  reviewed: 'bg-green-400',
};

// ---------------------------------------------------------------------------
// Tree view
// ---------------------------------------------------------------------------

interface NodeProps {
  node: TreeNode;
  wid: string;
  activeId: string | undefined;
  depth: number;
  matchIds: Set<string> | null;
}

function TreeNodeRow({ node, wid, activeId, depth, matchIds }: NodeProps) {
  const [open, setOpen] = useState(true);
  const isActive = node.id === activeId;
  const hidden = matchIds !== null && !matchIds.has(node.id);
  if (hidden) return null;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-1 pr-2 rounded-md text-sm cursor-pointer select-none
          ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <button
          className={`w-4 h-4 flex items-center justify-center text-xs text-gray-400 shrink-0 ${node.children.length === 0 ? 'invisible' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[node.status] ?? 'bg-gray-300'}`} />
        <Link to={`/worlds/${wid}/articles/${node.id}`} className="truncate flex-1" title={node.title}>
          {node.title}
        </Link>
      </div>
      {open && node.children.map((child) => (
        <TreeNodeRow key={child.id} node={child} wid={wid} activeId={activeId} depth={depth + 1} matchIds={matchIds} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flat (alphabetical) view
// ---------------------------------------------------------------------------

interface FlatRowProps {
  id: string;
  title: string;
  status: string;
  wid: string;
  activeId: string | undefined;
}

function FlatRow({ id, title, status, wid, activeId }: FlatRowProps) {
  const isActive = id === activeId;
  return (
    <div
      className={`flex items-center gap-1.5 py-1 px-2 rounded-md text-sm cursor-pointer select-none
        ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[status] ?? 'bg-gray-300'}`} />
      <Link to={`/worlds/${wid}/articles/${id}`} className="truncate flex-1" title={title}>
        {title}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

type ViewMode = 'tree' | 'flat';

export default function Sidebar() {
  const { wid, aid } = useParams<{ wid: string; aid: string }>();
  const navigate = useNavigate();
  const { treeNodes, searchQuery, setSearchQuery, loadTree, addToast } = useStore();

  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle]       = useState('');
  const [creating, setCreating]       = useState(false);
  const [viewMode, setViewMode]       = useState<ViewMode>('tree');

  // Flat list for search + flat view
  const flat = useMemo(() => {
    const out: { id: string; title: string; status: string }[] = [];
    function walk(nodes: typeof treeNodes) {
      for (const n of nodes) { out.push({ id: n.id, title: n.title, status: n.status }); walk(n.children); }
    }
    walk(treeNodes);
    return out;
  }, [treeNodes]);

  const flatSorted = useMemo(
    () => [...flat].sort((a, b) => a.title.localeCompare(b.title)),
    [flat],
  );

  const matchIds: Set<string> | null = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return new Set(flat.filter((a) => a.title.toLowerCase().includes(q)).map((a) => a.id));
  }, [flat, searchQuery]);

  const handleCreateArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wid || !newTitle.trim() || creating) return;
    setCreating(true);
    try {
      const result = await api.articles.create(wid, { title: newTitle.trim() });
      await loadTree(wid);
      setNewTitle('');
      setShowNewForm(false);
      navigate(`/worlds/${wid}/articles/${result.article.id}`);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <aside className="w-56 flex flex-col border-r border-gray-200 bg-surface-2 shrink-0 overflow-hidden">
      {/* Search */}
      <div className="p-2 border-b border-gray-200">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search…"
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* View mode toggle */}
      <div className="flex border-b border-gray-200">
        {(['tree', 'flat'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`flex-1 py-1 text-xs font-medium transition-colors ${
              viewMode === mode
                ? 'bg-white text-blue-700 border-b-2 border-blue-500'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            {mode === 'tree' ? 'Tree' : 'A–Z'}
          </button>
        ))}
      </div>

      {/* Article list */}
      <nav className="flex-1 overflow-y-auto py-1 px-1">
        {treeNodes.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-400">No articles yet.</p>
        ) : viewMode === 'tree' ? (
          treeNodes.map((node) => (
            <TreeNodeRow key={node.id} node={node} wid={wid ?? ''} activeId={aid} depth={0} matchIds={matchIds} />
          ))
        ) : (
          flatSorted
            .filter((a) => matchIds === null || matchIds.has(a.id))
            .map((a) => (
              <FlatRow key={a.id} id={a.id} title={a.title} status={a.status} wid={wid ?? ''} activeId={aid} />
            ))
        )}
      </nav>

      {/* New article */}
      <div className="border-t border-gray-200 px-2 py-2">
        {showNewForm ? (
          <form onSubmit={handleCreateArticle} className="flex flex-col gap-1.5">
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Article title…"
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex gap-1">
              <button
                type="submit"
                disabled={!newTitle.trim() || creating}
                className="flex-1 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
              >
                {creating ? '…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewForm(false); setNewTitle(''); }}
                className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowNewForm(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
          >
            <Plus size={14} />
            New Article
          </button>
        )}
      </div>

      {/* Status legend */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-gray-200 text-xs text-gray-400">
        {(['stub', 'draft', 'reviewed'] as ArticleStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot[s]}`} />
            {s}
          </span>
        ))}
      </div>
    </aside>
  );
}
