import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
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
  const { treeNodes, searchQuery, setSearchQuery } = useStore();

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
