import { useEffect, useState } from 'react';
import { ArrowLeft, Cpu, Palette, Settings, Type } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import type { ProviderSettingsResponse } from '../lib/api.ts';
import { useStore } from '../stores/index.ts';
import type { VisualTheme } from '../types/world.ts';

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

function providerModel(settings: ProviderSettingsResponse, provider: ProviderSettingsResponse['provider']): string {
  if (provider === 'none') return '';
  return settings[provider].model;
}

function GlobalSettingsPanel() {
  const { globalTheme, setGlobalTheme, fontSize, setFontSize } = useStore();

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Global Settings</h2>
          <p className="mt-1 text-xs text-gray-500">Theme and reading scale.</p>
        </div>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-600">
          <Palette size={16} aria-hidden="true" />
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
      </div>
    </section>
  );
}

function ProviderSettingsPanel() {
  const addToast = useStore((s) => s.addToast);
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
      addToast({ message: 'Provider settings saved.', type: 'success' });
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
          <h2 className="text-sm font-semibold text-gray-900">Provider Settings</h2>
          <p className="mt-1 text-xs text-gray-500">LLM configuration.</p>
        </div>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-600">
          <Cpu size={16} aria-hidden="true" />
        </span>
      </div>

      <div className="mt-5">
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
    </section>
  );
}

export default function AppSettingsPage() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <Link to="/" className="flex w-fit items-center gap-1 text-sm text-gray-400 hover:text-gray-700">
          <ArrowLeft size={14} />
          Worlds
        </Link>

        <header className="border-b border-gray-200 pb-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm">
            <Settings size={14} className="text-blue-600" aria-hidden="true" />
            App-level controls
          </div>
          <h1 className="text-3xl font-bold text-gray-950">App Settings</h1>
        </header>

        <GlobalSettingsPanel />
        <ProviderSettingsPanel />
      </div>
    </div>
  );
}
