import { useEffect, useState } from 'react';
import { ArrowLeft, X, Sparkles } from 'lucide-react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { ProviderSettingsResponse } from '../../lib/api.ts';
import type { VisualTheme } from '../../types/world.ts';

// ---------------------------------------------------------------------------
// Appearance constants (theme previews + font size steps)
// ---------------------------------------------------------------------------

interface ThemePreview {
  value: VisualTheme;
  label: string;
  desc: string;
  preview: { bg: string; surface: string; ink: string; accent: string; font: string; texture: string; textureSize: string };
}

const THEME_PREVIEWS: ThemePreview[] = [
  {
    value: 'default',
    label: 'Luminary',
    desc: 'Clean & modern',
    preview: {
      bg: '#ffffff', surface: '#f8fafc', ink: '#0f172a', accent: '#6d28d9',
      font: 'system-ui, sans-serif',
      texture: 'radial-gradient(rgba(15,23,42,0.04) 1px, transparent 1px)',
      textureSize: '20px 20px',
    },
  },
  {
    value: 'arcane_scroll',
    label: 'Arcane Scroll',
    desc: 'Parchment fantasy',
    preview: {
      bg: '#f4e8d0', surface: '#e8d5b0', ink: '#3d2b1f', accent: '#8b4513',
      font: "'IM Fell English', Georgia, serif",
      texture: "repeating-linear-gradient(45deg,transparent 0px,transparent 10px,rgba(139,90,43,0.07) 10px,rgba(139,90,43,0.07) 11px),repeating-linear-gradient(-45deg,transparent 0px,transparent 10px,rgba(139,90,43,0.07) 10px,rgba(139,90,43,0.07) 11px)",
      textureSize: 'auto',
    },
  },
  {
    value: 'data_link',
    label: 'Data-Link',
    desc: 'Dark sci-fi',
    preview: {
      bg: '#0a0e1a', surface: '#0d1220', ink: '#c8d8f0', accent: '#00d4ff',
      font: "'IBM Plex Mono', monospace",
      texture: "repeating-linear-gradient(0deg,transparent 0px,transparent 3px,rgba(0,200,255,0.03) 3px,rgba(0,200,255,0.03) 4px)",
      textureSize: 'auto',
    },
  },
  {
    value: 'dossier',
    label: 'The Dossier',
    desc: 'Typewriter noir',
    preview: {
      bg: '#f5f0e8', surface: '#ebe4d5', ink: '#2c2416', accent: '#8b6914',
      font: "'Courier Prime', 'Courier New', monospace",
      texture: "repeating-linear-gradient(180deg,transparent 0px,transparent 13px,rgba(100,80,50,0.1) 13px,rgba(100,80,50,0.1) 14px)",
      textureSize: 'auto',
    },
  },
  {
    value: 'obsidian_codex',
    label: 'Obsidian Codex',
    desc: 'Dark fantasy',
    preview: {
      bg: '#0b0810', surface: '#0f0c18', ink: '#d4c8f0', accent: '#9b72cf',
      font: "'Crimson Pro', Georgia, serif",
      texture: "repeating-linear-gradient(0deg,transparent 0px,transparent 15px,rgba(120,80,180,0.06) 15px,rgba(120,80,180,0.06) 16px),repeating-linear-gradient(90deg,transparent 0px,transparent 15px,rgba(120,80,180,0.06) 15px,rgba(120,80,180,0.06) 16px)",
      textureSize: 'auto',
    },
  },
  {
    value: 'verdant_atlas',
    label: 'Verdant Atlas',
    desc: 'Field journal',
    preview: {
      bg: '#f2f5ee', surface: '#e8ede3', ink: '#1c3a1c', accent: '#2e6b42',
      font: "'Lora', Georgia, serif",
      texture: 'radial-gradient(rgba(30,60,30,0.07) 1.2px, transparent 1.2px)',
      textureSize: '14px 14px',
    },
  },
];

const FONT_SIZE_STEPS = [0.85, 0.925, 1, 1.1, 1.2];
const FONT_SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL'];

// ---------------------------------------------------------------------------
// Main WorldSettings component
// ---------------------------------------------------------------------------

export default function WorldSettings() {
  const { wid } = useParams<{ wid: string }>();
  const navigate = useNavigate();
  const { worlds, updateWorld, deleteWorld, addToast, globalTheme, setGlobalTheme, fontSize, setFontSize } = useStore();

  const world = worlds.find((w) => w.id === wid);

  const [confirmName, setConfirmName]   = useState('');
  const [deleting, setDeleting]         = useState(false);
  const [saving, setSaving]             = useState(false);

  // Style fields
  const [vibe, setVibe]                   = useState(world?.styleConfig?.vibe ?? '');
  const [writingStyle, setWritingStyle]   = useState(world?.styleConfig?.writingStyle ?? '');
  const [inspirations, setInspirations]   = useState<string[]>(
    () => (world?.styleConfig?.inspirations ?? []).map((i) => i.name),
  );
  const [newInspirationName, setNewInspirationName] = useState('');
  const [expandingField, setExpandingField] = useState<'vibe' | 'writingStyle' | null>(null);

  // Distill state
  const [distilling, setDistilling]     = useState(false);
  const [distillPatch, setDistillPatch] = useState<{ vibe_append: string; writingStyle_append: string } | null>(null);
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
        setLocalOnly(settings.localOnly.enabled);
        const active = settings[settings.provider as keyof ProviderSettingsResponse] as { model?: string; url?: string } | undefined;
        setModel(active?.model ?? '');
        setOllamaUrl(settings.ollama.url);
      })
      .catch((err) => addToast({ message: (err as Error).message, type: 'error' }));
  }, [addToast]);

  if (!world) {
    return <div className="p-8 text-sm text-gray-400">World not found.</div>;
  }

  const canDelete = confirmName.trim() === world.name;

  const handleDelete = async () => {
    if (!canDelete || deleting || !wid) return;
    setDeleting(true);
    try {
      await deleteWorld(wid);
      navigate('/');
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
      setDeleting(false);
    }
  };

  const handleSaveStyle = async () => {
    if (!wid || saving) return;
    setSaving(true);
    try {
      await updateWorld(wid, {
        styleConfig: {
          vibe,
          writingStyle,
          inspirations: inspirations.map((name) => ({ name })),
          constraints: world.styleConfig?.constraints,
        },
      });
      addToast({ message: 'Style saved.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleExpandField = async (fieldType: 'vibe' | 'writingStyle') => {
    if (!wid) return;
    setExpandingField(fieldType);
    try {
      const rawText = fieldType === 'vibe' ? vibe : writingStyle;
      const apiFieldType = fieldType === 'writingStyle' ? 'writing_style' as const : 'vibe' as const;
      const result = await api.worlds.promptEngineer({
        fieldType: apiFieldType,
        rawText,
        worldName: world.name,
        worldDescription: world.description,
        wid,
      });
      if ('expandedDescription' in result) {
        if (fieldType === 'vibe') setVibe(result.expandedDescription);
        else setWritingStyle(result.expandedDescription);
      }
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setExpandingField(null);
    }
  };

  const handleDistill = async () => {
    if (!wid || inspirations.length === 0) return;
    setDistilling(true);
    setDistillPatch(null);
    try {
      const result = await api.worlds.promptEngineer({
        fieldType: 'distill',
        rawText: inspirations.join(', '),
        worldName: world.name,
        worldDescription: world.description,
        currentVibe: vibe,
        currentWritingStyle: writingStyle,
        wid,
      });
      if ('vibe_append' in result) {
        setDistillPatch({ vibe_append: result.vibe_append, writingStyle_append: result.writingStyle_append });
      }
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setDistilling(false);
    }
  };

  const handleApplyPatch = () => {
    if (!distillPatch) return;
    setVibe((v) => (v.trim() ? `${v.trim()} ${distillPatch.vibe_append}` : distillPatch.vibe_append));
    setWritingStyle((ws) => (ws.trim() ? `${ws.trim()} ${distillPatch.writingStyle_append}` : distillPatch.writingStyle_append));
    setDistillPatch(null);
  };

  const handleAddInspiration = () => {
    const name = newInspirationName.trim();
    if (!name || inspirations.some((n) => n.toLowerCase() === name.toLowerCase())) return;
    setInspirations((prev) => [...prev, name]);
    setNewInspirationName('');
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
      setApiKey('');
      addToast({ message: 'Provider settings saved.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSavingProvider(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-10 px-6">
      <Link to={`/worlds/${wid ?? ''}`} className="text-sm text-gray-400 hover:text-gray-700 flex items-center gap-1 w-fit">
        <ArrowLeft size={14} /> Back
      </Link>

      <h1 className="text-xl font-bold text-gray-900 mt-4 mb-1">Settings</h1>
      <p className="text-sm text-gray-500 mb-8">{world.name}</p>

      {/* World info (read-only) */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">World</h2>
        <dl className="text-sm text-gray-600 flex flex-col gap-2">
          <div className="flex gap-2"><dt className="font-medium w-24 shrink-0">Name</dt><dd>{world.name}</dd></div>
          <div className="flex gap-2"><dt className="font-medium w-24 shrink-0">Tone</dt><dd>{world.tone}</dd></div>
          {world.tags.length > 0 && (
            <div className="flex gap-2"><dt className="font-medium w-24 shrink-0">Tags</dt><dd>{world.tags.join(', ')}</dd></div>
          )}
          {world.originPoint && (
            <div className="flex gap-2"><dt className="font-medium w-24 shrink-0">Origin</dt><dd>{world.originPoint}</dd></div>
          )}
        </dl>
      </section>

      {/* App Appearance — global, instant */}
      <section className="mb-10 border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Appearance</h2>
        <p className="text-xs text-gray-400 mb-5">Global settings — apply instantly and persist across worlds.</p>

        {/* Theme grid */}
        <div className="mb-6">
          <label className="text-xs font-medium text-gray-700 block mb-2">Theme</label>
          <div className="grid grid-cols-3 gap-2">
            {(THEME_PREVIEWS as ThemePreview[]).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setGlobalTheme(t.value)}
                className="cursor-pointer text-left focus:outline-none transition-transform hover:scale-[1.02]"
                style={{
                  outline: globalTheme === t.value ? `2px solid ${t.preview.accent}` : '2px solid transparent',
                  outlineOffset: '2px',
                  borderRadius: '10px',
                }}
              >
                {/* Swatch */}
                <div
                  className="h-14 w-full overflow-hidden flex items-center justify-center"
                  style={{
                    background: t.preview.bg,
                    backgroundImage: t.preview.texture,
                    backgroundSize: t.preview.textureSize,
                    borderRadius: '8px 8px 0 0',
                    fontFamily: t.preview.font,
                    color: t.preview.ink,
                  }}
                >
                  <span style={{ fontSize: '1.6rem', lineHeight: 1, opacity: 0.85 }}>Aa</span>
                </div>
                {/* Accent strip */}
                <div style={{ height: '3px', background: t.preview.accent }} />
                {/* Label — uses this card's own font */}
                <div
                  className="px-2 py-1.5"
                  style={{
                    background: t.preview.surface,
                    borderRadius: '0 0 8px 8px',
                    border: `1px solid ${t.preview.accent}20`,
                    borderTop: 'none',
                    fontFamily: t.preview.font,
                  }}
                >
                  <p className="text-xs font-medium leading-tight" style={{ color: t.preview.ink, fontSize: '0.7rem' }}>{t.label}</p>
                  <p className="leading-tight mt-0.5" style={{ color: t.preview.ink, opacity: 0.5, fontSize: '0.62rem' }}>{t.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Font size slider */}
        <div>
          {(() => {
            const stepIdx = FONT_SIZE_STEPS.reduce((best, s, i) =>
              Math.abs(s - fontSize) < Math.abs(FONT_SIZE_STEPS[best] - fontSize) ? i : best, 2);
            return (
              <>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">Text Size</label>
                  <span className="text-xs text-gray-400">{FONT_SIZE_LABELS[stepIdx]}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={FONT_SIZE_STEPS.length - 1}
                  step={1}
                  value={stepIdx}
                  onChange={(e) => setFontSize(FONT_SIZE_STEPS[Number(e.target.value)])}
                  className="w-full wa-slider"
                />
              </>
            );
          })()}
          <div className="flex justify-between mt-1">
            {FONT_SIZE_LABELS.map((lbl) => (
              <span key={lbl} className="text-xs text-gray-400" style={{ fontSize: '0.6rem' }}>{lbl}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Style config */}
      <section className="mb-10 border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">World Style</h2>
        <p className="text-xs text-gray-400 mb-5">Controls the AI's aesthetic direction for all generated content.</p>

        {/* Vibe */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-gray-700">Vibe & Atmosphere</label>
            <button
              onClick={() => handleExpandField('vibe')}
              disabled={!vibe.trim() || expandingField === 'vibe'}
              className="text-xs text-purple-600 hover:text-purple-800 disabled:opacity-40"
            >
              {expandingField === 'vibe' ? 'Expanding…' : '✦ Expand with AI'}
            </button>
          </div>
          <textarea
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            rows={3}
            placeholder="e.g. bleak industrial, grey skies, tension beneath the surface…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-gray-300"
          />
        </div>

        {/* Writing style */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-gray-700">Writing Style</label>
            <button
              onClick={() => handleExpandField('writingStyle')}
              disabled={!writingStyle.trim() || expandingField === 'writingStyle'}
              className="text-xs text-purple-600 hover:text-purple-800 disabled:opacity-40"
            >
              {expandingField === 'writingStyle' ? 'Expanding…' : '✦ Expand with AI'}
            </button>
          </div>
          <textarea
            value={writingStyle}
            onChange={(e) => setWritingStyle(e.target.value)}
            rows={3}
            placeholder="e.g. terse, close third-person POV, short punchy sentences…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-gray-300"
          />
        </div>

        {/* Inspirations */}
        <div className="mb-5">
          <label className="text-xs font-medium text-gray-700 block mb-2">Inspirations</label>

          {/* Pill chips */}
          {inspirations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {inspirations.map((name, idx) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium"
                >
                  {name}
                  <button
                    onClick={() => setInspirations((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-purple-400 hover:text-purple-700 ml-0.5"
                    aria-label={`Remove ${name}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Add input */}
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newInspirationName}
              onChange={(e) => setNewInspirationName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddInspiration(); } }}
              placeholder="Add inspiration (e.g. Game of Thrones)"
              className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-gray-300"
            />
            <button
              onClick={handleAddInspiration}
              disabled={!newInspirationName.trim()}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-40"
            >
              Add
            </button>
          </div>

          {/* Distill button */}
          {inspirations.length > 0 && (
            <button
              onClick={handleDistill}
              disabled={distilling}
              className="flex items-center gap-1.5 text-xs text-purple-700 border border-purple-200 bg-purple-50 px-3 py-1.5 rounded-lg hover:bg-purple-100 disabled:opacity-50 transition-colors"
            >
              <Sparkles size={12} />
              {distilling ? 'Distilling…' : '✦ Distill to Style'}
            </button>
          )}
        </div>

        {/* Distill diff preview */}
        {distillPatch && (
          <div className="mb-5 border border-purple-200 rounded-lg bg-purple-50 p-4">
            <p className="text-xs font-semibold text-purple-800 mb-3">Style additions from inspirations</p>
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-600 mb-1">Vibe & Atmosphere</p>
              <p className="text-xs text-purple-900 bg-purple-100 rounded px-2 py-1.5 leading-relaxed">+ {distillPatch.vibe_append}</p>
            </div>
            <div className="mb-4">
              <p className="text-xs font-medium text-gray-600 mb-1">Writing Style</p>
              <p className="text-xs text-purple-900 bg-purple-100 rounded px-2 py-1.5 leading-relaxed">+ {distillPatch.writingStyle_append}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleApplyPatch}
                className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Apply
              </button>
              <button
                onClick={() => setDistillPatch(null)}
                className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        <button
          onClick={handleSaveStyle}
          disabled={saving}
          className="w-full py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save Style'}
        </button>
      </section>

      {/* Provider settings */}
      <section className="mb-10 border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">AI Provider</h2>
        <p className="text-xs text-gray-400 mb-5">Global settings for optional AI tools.</p>

        <div className="mb-4">
          <label className="text-xs font-medium text-gray-700 block mb-1.5">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderSettingsResponse['provider'])}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
          >
            <option value="none">None</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="groq">Groq</option>
            <option value="ollama">Ollama</option>
          </select>
        </div>

        {provider !== 'none' && provider !== 'ollama' && (
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-700 block mb-1.5">API key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={providerSettings?.[provider]?.keyMasked ?? 'Paste API key'}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
            />
            <p className="text-xs text-gray-400 mt-1">
              Current source: {providerSettings?.[provider]?.keySource ?? 'unset'}
            </p>
          </div>
        )}

        {provider === 'ollama' && (
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-700 block mb-1.5">Ollama URL</label>
            <input
              type="url"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
            />
          </div>
        )}

        {provider !== 'none' && (
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-700 block mb-1.5">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Model name"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
            />
          </div>
        )}

        <label className="mb-5 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={localOnly}
            disabled={providerSettings?.localOnly.forcedByEnv}
            onChange={(e) => setLocalOnly(e.target.checked)}
          />
          Local-only mode
          {providerSettings?.localOnly.forcedByEnv && <span className="text-xs text-gray-400">forced by env</span>}
        </label>

        <button
          onClick={handleSaveProvider}
          disabled={savingProvider}
          className="w-full py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {savingProvider ? 'Saving…' : 'Save Provider'}
        </button>
      </section>

      {/* Danger Zone */}
      <section className="border border-red-200 rounded-xl p-5 bg-red-50">
        <h2 className="text-sm font-semibold text-red-700 mb-1">Danger Zone</h2>
        <p className="text-sm text-red-600 mb-4">
          Deleting this world permanently removes all its articles, versions, and history. This cannot be undone.
        </p>

        <label className="block text-sm text-red-700 mb-1.5">
          Type <strong>{world.name}</strong> to confirm:
        </label>
        <input
          type="text"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={world.name}
          className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white mb-3"
        />
        <button
          onClick={handleDelete}
          disabled={!canDelete || deleting}
          className="w-full py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {deleting ? 'Deleting…' : 'Delete this world'}
        </button>
      </section>
    </div>
  );
}
