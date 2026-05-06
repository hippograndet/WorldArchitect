# Deferred: Force-Directed Graph View

A full-screen 3D graph page at `/worlds/:wid/graph` that visualises the entire article network.

## What it does

- Nodes = articles, coloured by status (`stub` gray / `draft` blue / `reviewed` green), sized by depth
- Edges = `article_links`, coloured by type (`hierarchical` purple / `references` blue)
- Click a node → navigate to `/worlds/:wid/articles/:id`
- Hover → floating title label
- Current article highlighted gold when navigated from ArticlePage
- Drag nodes to explore the graph

## Implementation sketch

### Dependency
```bash
npm install react-force-graph --workspace=client
```
`react-force-graph` bundles `ForceGraph3D` (Three.js/WebGL) — works on Intel i5 for worlds under ~500 nodes.

### New server endpoint
```
GET /api/worlds/:wid/articles/graph
→ { nodes: { id, title, status, depth }[], edges: { source, target, linkType }[] }
```
Add to `server/src/routes/articles.ts` (before the `/:aid` route to avoid param clash).
SQL: `SELECT id, title, status, depth FROM articles WHERE world_id = ?` for nodes; join `article_links` through `articles` to filter by world for edges.

### New client files
- `client/src/lib/api.ts` — add `api.articles.graph(wid)`
- `client/src/pages/GraphPage.tsx` — full-screen `<ForceGraph3D>`, data fetched on mount
- `client/src/routes.tsx` — add `{ path: 'graph', element: <GraphPage /> }` under AppShell children
- `client/src/components/layout/TopBar.tsx` — add "Graph" NavLink alongside "Timeline"

### GraphPage skeleton
```tsx
import ForceGraph3D from 'react-force-graph';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

export default function GraphPage() {
  const { wid } = useParams<{ wid: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState({ nodes: [], links: [] });

  useEffect(() => {
    if (wid) api.articles.graph(wid).then(({ nodes, edges }) =>
      setData({ nodes, links: edges.map(e => ({ ...e, source: e.source, target: e.target })) })
    );
  }, [wid]);

  return (
    <ForceGraph3D
      graphData={data}
      nodeColor={(n) => n.status === 'reviewed' ? '#4ade80' : n.status === 'draft' ? '#60a5fa' : '#9ca3af'}
      nodeVal={(n) => Math.max(1, 4 - n.depth) * 3}
      linkColor={(l) => l.linkType === 'hierarchical' ? '#7c3aed' : '#3b82f6'}
      onNodeClick={(n) => navigate(`/worlds/${wid}/articles/${n.id}`)}
      nodeLabel="title"
    />
  );
}
```

## Prerequisites
- Phase 1 (Page View) complete — `linkType` already added to `article_links` query
- Theme Skins (Phase 2) complete — graph canvas should respect `data-theme` background colour
