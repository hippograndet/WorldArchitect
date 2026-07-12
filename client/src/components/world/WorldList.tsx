import { useEffect, useState } from 'react';
import {
  Compass,
  Layers3,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { ArticleGraphNode } from '../../types/article.ts';
import type { World } from '../../types/world.ts';

const toneLabels: Record<World['tone'], string> = {
  narrative: 'Narrative',
  academic: 'Academic',
  terse: 'Terse',
  custom: 'Custom',
};

interface WorldHomeMeta {
  pageCount: number;
  rootIntro: string;
}

function rootNode(nodes: ArticleGraphNode[]): ArticleGraphNode | undefined {
  return [...nodes].sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title))[0];
}

function WorldCard({ world, meta }: { world: World; meta: WorldHomeMeta | undefined }) {
  const visibleTags = world.tags.slice(0, 3);
  const hiddenTagCount = Math.max(0, world.tags.length - visibleTags.length);
  const rootIntro = meta?.rootIntro.trim();
  const pageCount = meta?.pageCount;

  return (
    <article className="group bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:border-blue-200 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-4">
        <Link to={`/worlds/${world.id}`} className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <Compass size={16} aria-hidden="true" />
            </span>
            <span className="text-xs font-medium text-gray-500">{toneLabels[world.tone]}</span>
            <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">
              {pageCount === undefined ? '...' : pageCount} page{pageCount === 1 ? '' : 's'}
            </span>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 group-hover:text-blue-700 transition-colors truncate">
            {world.name}
          </h2>
          <p className="mt-3 text-sm text-gray-600 leading-6 line-clamp-4">
            {rootIntro || world.description || 'No root article intro yet.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {visibleTags.map((tag) => (
              <span key={tag} className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                {tag}
              </span>
            ))}
            {hiddenTagCount > 0 && (
              <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500">
                +{hiddenTagCount}
              </span>
            )}
          </div>
        </Link>

        <Link
          to={`/worlds/${world.id}/settings`}
          className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          title="World settings"
          aria-label={`${world.name} settings`}
        >
          <Settings size={16} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

export default function WorldList() {
  const navigate = useNavigate();
  const { worlds, loadWorlds } = useStore();
  const [worldMeta, setWorldMeta] = useState<Record<string, WorldHomeMeta>>({});

  useEffect(() => {
    loadWorlds().catch(console.error);
  }, [loadWorlds]);

  useEffect(() => {
    let active = true;

    async function loadHomeMeta() {
      const entries = await Promise.all(worlds.map(async (world) => {
        try {
          const graph = await api.articles.graph(world.id);
          const root = rootNode(graph.nodes);
          return [world.id, {
            pageCount: graph.nodes.length,
            rootIntro: root?.introduction ?? '',
          }] as const;
        } catch {
          return [world.id, { pageCount: 0, rootIntro: '' }] as const;
        }
      }));

      if (active) setWorldMeta(Object.fromEntries(entries));
    }

    if (worlds.length > 0) loadHomeMeta().catch(console.error);
    else setWorldMeta({});

    return () => { active = false; };
  }, [worlds]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-7 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm">
              <Sparkles size={14} className="text-blue-600" aria-hidden="true" />
              Story worlds and living reference bibles
            </div>
            <h1 className="text-3xl font-bold text-gray-950">WorldArchitect</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
              Choose a world to continue shaping its articles, graph, snapshots, and publishing workflow.
            </p>
          </div>
          <Link
            to="/settings"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-800"
            title="App settings"
            aria-label="App settings"
          >
            <Settings size={17} aria-hidden="true" />
          </Link>
        </header>

        <div>
          <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Worlds</h2>
                <p className="mt-1 text-xs text-gray-500">{worlds.length} saved world{worlds.length === 1 ? '' : 's'}</p>
              </div>
              <button
                onClick={() => navigate('/new')}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                <Plus size={16} aria-hidden="true" />
                New World
              </button>
            </div>

            {worlds.length === 0 ? (
              <div className="grid min-h-[36vh] place-items-center px-6 py-12 text-center">
                <div className="max-w-md">
                  <span className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <Layers3 size={22} aria-hidden="true" />
                  </span>
                  <h3 className="text-xl font-semibold text-gray-950">Start with a blank atlas</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    Create your first world and WorldArchitect will set up the workspace around it.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid gap-4">
                {worlds.map((world) => (
                  <WorldCard key={world.id} world={world} meta={worldMeta[world.id]} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
