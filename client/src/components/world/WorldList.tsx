import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Clock3,
  Compass,
  Cpu,
  Layers3,
  Palette,
  Plus,
  Settings,
  Sparkles,
  Type,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { ProviderSettingsResponse } from '../../lib/api.ts';
import type { VisualTheme, World } from '../../types/world.ts';

function timestampValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeAgo(value: unknown): string {
  const ms = timestampValue(value);
  if (ms === null) return 'unknown';

  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const toneLabels: Record<World['tone'], string> = {
  narrative: 'Narrative',
  academic: 'Academic',
  terse: 'Terse',
  custom: 'Custom',
};

const providerLabels: Record<ProviderSettingsResponse['provider'], string> = {
  none: 'None',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  groq: 'Groq',
  ollama: 'Ollama',
};

const themeOptions: { value: VisualTheme; label: string }[] = [
  { value: 'default', label: 'Luminary' },
  { value: 'arcane_scroll', label: 'Arcane Scroll' },
  { value: 'data_link', label: 'Data-Link' },
  { value: 'dossier', label: 'The Dossier' },
  { value: 'obsidian_codex', label: 'Obsidian Codex' },
  { value: 'verdant_atlas', label: 'Verdant Atlas' },
];

const fontSizeOptions = [
  { value: 0.85, label: 'XS' },
  { value: 0.925, label: 'S' },
  { value: 1, label: 'M' },
  { value: 1.1, label: 'L' },
  { value: 1.2, label: 'XL' },
];

function formatDate(value: unknown): string {
  const ms = timestampValue(value);
  if (ms === null) return 'Unknown date';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}

function WorldCard({ world }: { world: World }) {
  const visibleTags = world.tags.slice(0, 3);
  const hiddenTagCount = Math.max(0, world.tags.length - visibleTags.length);

  return (
    <article className="group bg-white border border-gray-200 rounded-lg p-5 shadow-sm hover:border-blue-200 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <Compass size={16} aria-hidden="true" />
            </span>
            <span className="text-xs font-medium text-gray-500">{toneLabels[world.tone]}</span>
          </div>
          <Link to={`/worlds/${world.id}`} className="block">
            <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-700 transition-colors truncate">
              {world.name}
            </h2>
          </Link>
          <p className="mt-2 text-sm text-gray-600 leading-relaxed line-clamp-2">
            {world.description || 'No description yet.'}
          </p>
        </div>

        <Link
          to={`/worlds/${world.id}/settings`}
          className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          title="World settings"
          aria-label={`${world.name} settings`}
        >
          <Settings size={16} aria-hidden="true" />
        </Link>
      </div>

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

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-gray-100 pt-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-gray-500">
          <Clock3 size={14} className="shrink-0" aria-hidden="true" />
          <span className="truncate" title={`Updated ${formatDate(world.updatedAt)}`}>
            Updated {timeAgo(world.updatedAt)}
          </span>
        </div>
        <Link
          to={`/worlds/${world.id}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          Open
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function providerModel(settings: ProviderSettingsResponse, provider: ProviderSettingsResponse['provider']): string {
  if (provider === 'none') return '';
  return settings[provider].model;
}

function GlobalSettingsPanel() {
  const { addToast, globalTheme, setGlobalTheme, fontSize, setFontSize } = useStore();
  const [providerSettings, setProviderSettings] = useState<ProviderSettingsResponse | null>(null);
  const [provider, setProvider] = useState<ProviderSettingsResponse['provider']>('none');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  useEffect(() => {
    api.settings.get()
      .then((settings) => {
        setProviderSettings(settings);
        setProvider(settings.provider);
        setModel(providerModel(settings, settings.provider));
        setOllamaUrl(settings.ollama.url);
        setLocalOnly(settings.localOnly.enabled);
      })
      .catch((err) => addToast({ message: (err as Error).message, type: 'error' }));
  }, [addToast]);

  const handleProviderChange = (nextProvider: ProviderSettingsResponse['provider']) => {
    setProvider(nextProvider);
    setApiKey('');
    if (!providerSettings) return;
    setModel(providerModel(providerSettings, nextProvider));
    setOllamaUrl(providerSettings.ollama.url);
  };

  const handleSaveProvider = async () => {
    setSavingProvider(true);
    try {
      const input: { provider: string; apiKey?: string; model?: string; ollamaUrl?: string; localOnly?: boolean } = {
        provider,
        localOnly,
      };
      if (apiKey.trim() && provider !== 'none' && provider !== 'ollama') input.apiKey = apiKey.trim();
      if (model.trim() && provider !== 'none') input.model = model.trim();
      if (ollamaUrl.trim() && provider === 'ollama') input.ollamaUrl = ollamaUrl.trim();
      await api.settings.update(input);
      const refreshed = await api.settings.get();
      setProviderSettings(refreshed);
      setProvider(refreshed.provider);
      setModel(providerModel(refreshed, refreshed.provider));
      setOllamaUrl(refreshed.ollama.url);
      setLocalOnly(refreshed.localOnly.enabled);
      setApiKey('');
      addToast({ message: 'Global provider settings saved.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSavingProvider(false);
    }
  };

  const activeProviderSettings = providerSettings && provider !== 'none' && provider !== 'ollama'
    ? providerSettings[provider]
    : null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Global Settings</h2>
          <p className="mt-1 text-xs text-gray-500">Applies across every world.</p>
        </div>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-600">
          <Settings size={16} aria-hidden="true" />
        </span>
      </div>

      <div className="mt-5 space-y-5">
        <div>
          <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-700">
            <Palette size={14} aria-hidden="true" />
            Theme
          </label>
          <select
            value={globalTheme}
            onChange={(event) => setGlobalTheme(event.target.value as VisualTheme)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {themeOptions.map((theme) => (
              <option key={theme.value} value={theme.value}>{theme.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-700">
            <Type size={14} aria-hidden="true" />
            Text Size
          </label>
          <div className="grid grid-cols-5 gap-1">
            {fontSizeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFontSize(option.value)}
                className={`rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors ${
                  fontSize === option.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-5">
          <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-700">
            <Cpu size={14} aria-hidden="true" />
            LLM Provider
          </label>
          <select
            value={provider}
            onChange={(event) => handleProviderChange(event.target.value as ProviderSettingsResponse['provider'])}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {(Object.keys(providerLabels) as ProviderSettingsResponse['provider'][]).map((value) => (
              <option key={value} value={value}>{providerLabels[value]}</option>
            ))}
          </select>

          {provider !== 'none' && provider !== 'ollama' && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-500">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={activeProviderSettings?.keyMasked ?? 'Paste API key'}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                Current source: {activeProviderSettings?.keySource ?? 'unset'}
              </p>
            </div>
          )}

          {provider === 'ollama' && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-500">Ollama URL</label>
              <input
                type="url"
                value={ollamaUrl}
                onChange={(event) => setOllamaUrl(event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          {provider !== 'none' && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-500">Model</label>
              <input
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={localOnly}
              onChange={(event) => setLocalOnly(event.target.checked)}
              disabled={providerSettings?.localOnly.forcedByEnv}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Local-only mode
            {providerSettings?.localOnly.forcedByEnv && <span className="text-gray-400">forced by env</span>}
          </label>

          <button
            type="button"
            onClick={handleSaveProvider}
            disabled={savingProvider}
            className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingProvider ? 'Saving...' : 'Save Provider'}
          </button>
        </div>
      </div>
    </section>
  );
}

export default function WorldList() {
  const navigate = useNavigate();
  const { worlds, loadWorlds } = useStore();

  useEffect(() => {
    loadWorlds().catch(console.error);
  }, [loadWorlds]);

  const latestWorld = worlds[0];
  const now = Date.now();
  const recentlyUpdated = worlds.filter((world) => {
    const updatedAt = timestampValue(world.updatedAt);
    return updatedAt !== null && now - updatedAt < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const tagCount = new Set(worlds.flatMap((world) => world.tags)).size;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 border-b border-gray-200 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm">
              <Sparkles size={14} className="text-blue-600" aria-hidden="true" />
              Story worlds and living reference bibles
            </div>
            <h1 className="text-3xl font-bold text-gray-950">WorldArchitect</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
              Choose a world to continue shaping its articles, graph, timeline, and publishing workflow.
            </p>
          </div>
          <button
            onClick={() => navigate('/new')}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus size={16} aria-hidden="true" />
            New World
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {worlds.length === 0 ? (
            <div className="grid min-h-[52vh] place-items-center rounded-lg border border-dashed border-gray-300 bg-white px-6 py-16 text-center shadow-sm">
              <div className="max-w-md">
                <span className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <Layers3 size={22} aria-hidden="true" />
                </span>
                <h2 className="text-xl font-semibold text-gray-950">Start with a blank atlas</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  Create your first world and WorldArchitect will set up the workspace around it.
                </p>
                <button
                  onClick={() => navigate('/new')}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  <Plus size={16} aria-hidden="true" />
                  Create World
                </button>
              </div>
            </div>
          ) : (
            <section className="grid gap-4 sm:grid-cols-2">
              {worlds.map((world) => (
                <WorldCard key={world.id} world={world} />
              ))}
            </section>
          )}

          <aside className="space-y-4">
            <GlobalSettingsPanel />

            {worlds.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-900">Library</h2>
                <div className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-1">
                  <div className="rounded-md bg-gray-50 p-3">
                    <p className="text-2xl font-bold text-gray-950">{worlds.length}</p>
                    <p className="mt-0.5 text-xs text-gray-500">Worlds</p>
                  </div>
                  <div className="rounded-md bg-gray-50 p-3">
                    <p className="text-2xl font-bold text-blue-700">{recentlyUpdated}</p>
                    <p className="mt-0.5 text-xs text-gray-500">This week</p>
                  </div>
                  <div className="rounded-md bg-gray-50 p-3">
                    <p className="text-2xl font-bold text-green-700">{tagCount}</p>
                    <p className="mt-0.5 text-xs text-gray-500">Tags</p>
                  </div>
                </div>
              </div>
            )}

            {latestWorld && (
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-900">Latest Work</h2>
                <p className="mt-3 text-base font-semibold text-gray-950">{latestWorld.name}</p>
                <p className="mt-1 text-xs text-gray-500">Updated {formatDate(latestWorld.updatedAt)}</p>
                <Link
                  to={`/worlds/${latestWorld.id}`}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Continue
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
