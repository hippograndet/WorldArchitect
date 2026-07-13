import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, GitBranch, Link as LinkIcon, Plus, RefreshCw } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useStore } from '../stores/index.ts';
import type { ArticleGraph, ArticleGraphEdge, ArticleGraphNode } from '../types/article.ts';

type PositionedNode = ArticleGraphNode & { x: number; y: number };
type LinkType = ArticleGraphEdge['linkType'];
type DragState = { pointerId: number; x: number; y: number; panX: number; panY: number };

const NODE_WIDTH = 190;
const NODE_HEIGHT = 54;

const statusStyles = {
  stub:     'var(--graph-stub)',
  draft:    'var(--graph-draft)',
  reviewed: 'var(--graph-reviewed)',
};

const linkStyles: Record<LinkType, { stroke: string; dash?: string; label: string }> = {
  hierarchical: { stroke: 'var(--graph-edge-hierarchy)', label: 'Hierarchy' },
  references:   { stroke: 'var(--graph-edge-reference)', dash: '6 5', label: 'Reference' },
};

function graphLinkStyle(linkType: ArticleGraphEdge['linkType'] | string | null | undefined) {
  return linkType === 'hierarchical' ? linkStyles.hierarchical : linkStyles.references;
}

function edgePoint(from: PositionedNode, to: PositionedNode) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const scale = Math.min(
    Math.abs(dx) > 0 ? (NODE_WIDTH / 2) / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 0 ? (NODE_HEIGHT / 2) / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );

  return {
    x: from.x + dx * scale,
    y: from.y + dy * scale,
  };
}

function buildLayout(graph: ArticleGraph): {
  nodes: PositionedNode[];
  rings: { depth: number; radius: number }[];
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} {
  if (graph.nodes.length === 0) {
    return { nodes: [], rings: [], width: 920, height: 620, centerX: 460, centerY: 310 };
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, ArticleGraphNode[]>();
  const parentByChild = new Map<string, string>();

  for (const edge of graph.edges) {
    if (edge.linkType !== 'hierarchical') continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || parentByChild.has(target.id)) continue;
    parentByChild.set(target.id, source.id);
    childrenByParent.set(source.id, [...(childrenByParent.get(source.id) ?? []), target]);
  }

  const roots = graph.nodes
    .filter((node) => !parentByChild.has(node.id))
    .sort((a, b) => (a.depth || 1) - (b.depth || 1) || a.title.localeCompare(b.title));
  const root = roots[0] ?? graph.nodes[0];
  const rootDepth = Math.max(1, root.depth || 1);
  const ringStep = 300;
  const padding = 170;
  const levelById = new Map<string, number>([[root.id, 0]]);
  const queue = [root];

  while (queue.length > 0) {
    const parent = queue.shift()!;
    const parentLevel = levelById.get(parent.id) ?? 0;
    const children = [...(childrenByParent.get(parent.id) ?? [])].sort((a, b) => a.title.localeCompare(b.title));
    for (const child of children) {
      if (levelById.has(child.id)) continue;
      levelById.set(child.id, parentLevel + 1);
      queue.push(child);
    }
  }

  const nodesByLevel = new Map<number, ArticleGraphNode[]>();
  for (const node of graph.nodes) {
    if (node.id === root.id) continue;
    const hierarchyLevel = levelById.get(node.id);
    const storedLevel = Math.max(1, (node.depth || rootDepth + 1) - rootDepth);
    const level = hierarchyLevel ?? storedLevel;
    nodesByLevel.set(level, [...(nodesByLevel.get(level) ?? []), node]);
  }

  const maxRing = Math.max(1, ...[...nodesByLevel.keys()]);
  const radius = maxRing * ringStep;
  const width = Math.max(920, radius * 2 + padding * 2);
  const height = Math.max(680, radius * 2 + padding * 2);
  const centerX = width / 2;
  const centerY = height / 2;
  const angleById = new Map<string, number>([[root.id, -Math.PI / 2]]);
  const positioned: PositionedNode[] = [{ ...root, x: centerX, y: centerY }];

  for (const ring of [...nodesByLevel.keys()].sort((a, b) => a - b)) {
    const nodes = [...(nodesByLevel.get(ring) ?? [])].sort((a, b) => {
      const parentA = parentByChild.get(a.id);
      const parentB = parentByChild.get(b.id);
      const parentAngleA = parentA ? angleById.get(parentA) ?? 0 : Number.POSITIVE_INFINITY;
      const parentAngleB = parentB ? angleById.get(parentB) ?? 0 : Number.POSITIVE_INFINITY;
      return parentAngleA - parentAngleB || a.title.localeCompare(b.title);
    });
    const ringRadius = ring * ringStep;
    const freeNodes: ArticleGraphNode[] = [];
    const childrenByKnownParent = new Map<string, ArticleGraphNode[]>();

    for (const node of nodes) {
      const parentId = parentByChild.get(node.id);
      if (!parentId || parentId === root.id || !angleById.has(parentId)) {
        freeNodes.push(node);
        continue;
      }
      childrenByKnownParent.set(parentId, [...(childrenByKnownParent.get(parentId) ?? []), node]);
    }

    for (const [parentId, children] of childrenByKnownParent) {
      const parentAngle = angleById.get(parentId) ?? -Math.PI / 2;
      const minimumSpacing = (NODE_WIDTH + 50) / ringRadius;
      const spread = Math.min(Math.PI * 1.2, Math.max(Math.PI / 8, minimumSpacing * Math.max(1, children.length - 1)));
      children.forEach((node, index) => {
        const offset = children.length === 1 ? 0 : -spread / 2 + (index / (children.length - 1)) * spread;
        const angle = parentAngle + offset;
        angleById.set(node.id, angle);
        positioned.push({
          ...node,
          x: centerX + Math.cos(angle) * ringRadius,
          y: centerY + Math.sin(angle) * ringRadius,
        });
      });
    }

    const freeStart = -Math.PI / 2 - Math.PI / Math.max(1, freeNodes.length);
    freeNodes.forEach((node, index) => {
      const angle = freeStart + (index / Math.max(1, freeNodes.length)) * Math.PI * 2;
      angleById.set(node.id, angle);
      positioned.push({
        ...node,
        x: centerX + Math.cos(angle) * ringRadius,
        y: centerY + Math.sin(angle) * ringRadius,
      });
    });
  }

  const rings = [...nodesByLevel.keys()]
    .sort((a, b) => a - b)
    .map((ring) => ({ depth: rootDepth + ring, radius: ring * ringStep }));

  return { nodes: positioned, rings, width, height, centerX, centerY };
}

export default function GraphPage() {
  const { wid } = useParams<{ wid: string }>();
  const navigate = useNavigate();
  const { addToast, loadTree } = useStore();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const centeredRef = useRef(false);

  const [graph, setGraph] = useState<ArticleGraph>({ nodes: [], edges: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [linkType, setLinkType] = useState<LinkType>('references');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;

  const loadGraph = useCallback(async () => {
    if (!wid) return;
    setLoading(true);
    try {
      const data = await api.articles.graph(wid);
      centeredRef.current = false;
      setGraph(data);
      const firstNode = data.nodes[0];
      setSelectedId((current) => current && data.nodes.some((node) => node.id === current) ? current : firstNode?.id ?? null);
      setSourceId((current) => current && data.nodes.some((node) => node.id === current) ? current : firstNode?.id ?? '');
      setTargetId((current) => current && data.nodes.some((node) => node.id === current) ? current : data.nodes[1]?.id ?? firstNode?.id ?? '');
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast, wid]);

  useEffect(() => {
    loadGraph().catch(console.error);
  }, [loadGraph]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const resize = () => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const regenerate = () => {
      if (document.visibilityState === 'visible') {
        loadGraph().catch(console.error);
      }
    };

    window.addEventListener('focus', regenerate);
    document.addEventListener('visibilitychange', regenerate);
    return () => {
      window.removeEventListener('focus', regenerate);
      document.removeEventListener('visibilitychange', regenerate);
    };
  }, [loadGraph]);

  useEffect(() => {
    if (!selectedId) return;
    setSourceId(selectedId);
  }, [selectedId]);

  const layout = useMemo(() => buildLayout(graph), [graph]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);

  useEffect(() => {
    if (centeredRef.current || graph.nodes.length === 0 || viewport.width === 0 || viewport.height === 0) return;
    setPan({
      x: viewport.width / 2 - layout.centerX,
      y: viewport.height / 2 - layout.centerY,
    });
    centeredRef.current = true;
  }, [graph.nodes.length, layout.centerX, layout.centerY, viewport.height, viewport.width]);

  const incoming = selected
    ? graph.edges.filter((edge) => edge.target === selected.id)
    : [];
  const outgoing = selected
    ? graph.edges.filter((edge) => edge.source === selected.id)
    : [];

  const handleAddEdge = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!wid || !sourceId || !targetId || sourceId === targetId || saving) return;

    setSaving(true);
    try {
      await api.articles.createLink(wid, { source: sourceId, target: targetId, linkType });
      await loadGraph();
      await loadTree(wid);
      addToast({ message: 'Edge added.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.panX + event.clientX - drag.x,
      y: drag.panY + event.clientY - drag.y,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  return (
    <div className="wa-graph h-full min-h-0 flex">
      <section className="flex-1 min-w-0 flex flex-col">
        <div className="h-14 shrink-0 flex items-center justify-between gap-4 border-b border-gray-200 bg-surface px-5">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Graph</h1>
            <p className="text-xs text-gray-500">
              {graph.nodes.length} articles · {graph.edges.length} edges
            </p>
          </div>
          <button
            onClick={() => loadGraph().catch(console.error)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 px-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            disabled={loading}
          >
            <RefreshCw size={14} />
            Regenerate
          </button>
        </div>

        <div
          ref={canvasRef}
          className="wa-graph-canvas relative flex-1 min-h-0 overflow-hidden cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {loading ? (
            <div className="p-8 text-sm text-gray-400">Loading...</div>
          ) : graph.nodes.length === 0 ? (
            <div className="p-8 text-sm text-gray-400">No articles yet.</div>
          ) : (
            <svg
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="absolute left-0 top-0 block"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
              role="img"
              aria-label="Article graph"
            >
              <defs>
                <marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--graph-arrow)" />
                </marker>
              </defs>

              {layout.rings.map((ring) => (
                <g key={ring.depth}>
                  <circle
                    cx={layout.centerX}
                    cy={layout.centerY}
                    r={ring.radius}
                    fill="none"
                    stroke="var(--graph-node-stroke)"
                    strokeWidth="1"
                    strokeOpacity="0.28"
                  />
                  <text
                    x={layout.centerX}
                    y={layout.centerY - ring.radius - 10}
                    textAnchor="middle"
                    fill="var(--graph-node-muted)"
                    fontSize="10"
                    opacity="0.72"
                  >
                    depth {ring.depth}
                  </text>
                </g>
              ))}

              {graph.edges.map((edge) => {
                const source = nodeById.get(edge.source);
                const target = nodeById.get(edge.target);
                if (!source || !target) return null;
                const selectedEdge = selectedId === edge.source || selectedId === edge.target;
                const style = graphLinkStyle(edge.linkType);
                const start = edgePoint(source, target);
                const end = edgePoint(target, source);

                return (
                  <line
                    key={`${edge.source}-${edge.target}`}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={style.stroke}
                    strokeWidth={selectedEdge ? 2.5 : 1.5}
                    strokeOpacity={selectedEdge ? 0.9 : 0.42}
                    strokeDasharray={style.dash}
                    markerEnd="url(#graph-arrow)"
                  />
                );
              })}

              {layout.nodes.map((node, index) => {
                const isSelected = node.id === selectedId;
                const statusColor = statusStyles[node.status] ?? statusStyles.stub;
                const titleId = `graph-node-title-${index}`;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x - NODE_WIDTH / 2}, ${node.y - NODE_HEIGHT / 2})`}
                    className="cursor-pointer"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(node.id);
                    }}
                  >
                    <rect
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx="8"
                      fill="var(--graph-node-fill)"
                      stroke={isSelected ? 'var(--graph-selected)' : 'var(--graph-node-stroke)'}
                      strokeWidth={isSelected ? 3 : 1.5}
                    />
                    <circle cx="18" cy="18" r="4" fill={statusColor} />
                    <foreignObject x="31" y="9" width={NODE_WIDTH - 47} height="18">
                      <div
                        id={titleId}
                        className="truncate text-[13px] leading-[18px]"
                        style={{
                          color: 'var(--graph-node-text)',
                          fontWeight: isSelected ? 700 : 600,
                        }}
                      >
                        {node.title}
                      </div>
                    </foreignObject>
                    <foreignObject x="31" y="29" width={NODE_WIDTH - 47} height="16">
                      <div
                        className="truncate text-[10px] uppercase leading-4"
                        style={{ color: 'var(--graph-node-muted)' }}
                      >
                        depth {node.depth} · {node.status}
                      </div>
                    </foreignObject>
                    <title>{node.title}</title>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </section>

      <aside className="w-80 shrink-0 border-l border-gray-200 bg-surface overflow-y-auto">
        <div className="p-4 border-b border-gray-200">
          {selected ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Selected</p>
                <h2 className="mt-1 text-lg font-semibold leading-tight text-gray-900">{selected.title}</h2>
                <p className="mt-1 text-xs text-gray-500">{selected.templateType} · depth {selected.depth} · {selected.status}</p>
                <div className="mt-3 rounded-lg border border-gray-200 bg-surface-2 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Introduction</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                    {selected.introduction || 'No introduction written yet.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => wid && navigate(`/worlds/${wid}/articles/${selected.id}`)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-700"
              >
                <ExternalLink size={14} />
                Open
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No article selected.</p>
          )}
        </div>

        <form onSubmit={handleAddEdge} className="p-4 border-b border-gray-200 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Plus size={15} />
            Add Edge
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">From</span>
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {graph.nodes.map((node) => (
                <option key={node.id} value={node.id}>{node.title}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">To</span>
            <select
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {graph.nodes.map((node) => (
                <option key={node.id} value={node.id}>{node.title}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1">
            {(['references', 'hierarchical'] as LinkType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setLinkType(type)}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium ${
                  linkType === type ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {type === 'references' ? <LinkIcon size={13} /> : <GitBranch size={13} />}
                {linkStyles[type].label}
              </button>
            ))}
          </div>

          <button
            type="submit"
            disabled={!sourceId || !targetId || sourceId === targetId || saving}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Adding...' : 'Add Edge'}
          </button>
        </form>

        <div className="p-4 space-y-5">
          <EdgeList title="Outgoing" edges={outgoing} nodes={nodeById} worldId={wid} />
          <EdgeList title="Incoming" edges={incoming} nodes={nodeById} worldId={wid} />
        </div>
      </aside>
    </div>
  );
}

function EdgeList({
  title,
  edges,
  nodes,
  worldId,
}: {
  title: string;
  edges: ArticleGraphEdge[];
  nodes: Map<string, PositionedNode>;
  worldId?: string;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      {edges.length === 0 ? (
        <p className="text-xs text-gray-400">None</p>
      ) : (
        <div className="space-y-1.5">
          {edges.map((edge) => {
            const otherId = title === 'Outgoing' ? edge.target : edge.source;
            const node = nodes.get(otherId);
            if (!node) return null;
            const style = graphLinkStyle(edge.linkType);
            return (
              <Link
                key={`${edge.source}-${edge.target}`}
                to={worldId ? `/worlds/${worldId}/articles/${node.id}` : '#'}
                className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:bg-gray-50"
              >
                <span className="truncate">{node.title}</span>
                <span className="shrink-0 text-[10px] uppercase text-gray-400">{style.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
