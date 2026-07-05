import { useState } from 'react';
import { ArrowLeft, X, Sparkles } from 'lucide-react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { WorldStyleConfig } from '../../types/world.ts';

interface GuidancePreset {
  key: string;
  label: string;
  value: string;
}

const TONE_PRESETS: GuidancePreset[] = [
  {
    key: 'story_companion',
    label: 'Story Companion',
    value: 'Write in an engaging, clear worldbuilding voice: authoritative enough to feel reliable, but evocative enough to carry atmosphere, character, and conflict. Treat each entry like part of a living story bible.',
  },
  {
    key: 'archive_record',
    label: 'Archive Record',
    value: 'Write with restrained authority, as if compiling records for an internal archive. Prioritize clarity, continuity, dates, causes, consequences, and relationships over dramatic flourish.',
  },
  {
    key: 'mythic_chronicle',
    label: 'Mythic Chronicle',
    value: 'Write with a sense of age, consequence, and remembered grandeur. Let entries feel like chronicles of events that shaped peoples, places, institutions, and beliefs over generations.',
  },
];

const VIBE_PRESETS: GuidancePreset[] = [
  {
    key: 'epic_fantasy',
    label: 'Epic Fantasy',
    value: 'Grand, mythic, ancient. A world where the weight of history is felt in every stone and the stakes of every conflict echo across ages. Magic is real but costly. Heroes are forged by sacrifice.',
  },
  {
    key: 'gritty_realism',
    label: 'Gritty Realism',
    value: 'Low-magic, brutal, political. Power is held by those willing to do what others will not. Moral ambiguity is the rule. Even heroic figures have blood on their hands. No clean victories.',
  },
  {
    key: 'cosmic_horror',
    label: 'Cosmic Horror',
    value: 'Vast indifference, dread, and the creeping sense that human understanding is a thin veil over an incomprehensible reality. Knowledge is dangerous. Sanity is fragile.',
  },
  {
    key: 'space_opera',
    label: 'Space Opera',
    value: 'Interstellar scale, wonder, and conflict. Empires span star systems. Individual heroes shape galactic events. Technology is indistinguishable from magic. The universe is vast but populated and alive.',
  },
];

const WRITING_STYLE_PRESETS: GuidancePreset[] = [
  {
    key: 'elevated',
    label: 'Elevated',
    value: 'Use elevated, lyrical prose with deliberate rhythm. Favor precise imagery, resonant proper nouns, lineage references, and in-world terminology. Avoid irony unless the world itself calls for it.',
  },
  {
    key: 'lean_visceral',
    label: 'Lean & Visceral',
    value: 'Use sparse, direct prose. Shorten sentences under pressure. Keep vocabulary earthy and concrete. Violence and conflict should carry consequences. Avoid decorative prose that does not reveal character, place, or tension.',
  },
  {
    key: 'slow_dread',
    label: 'Slow Dread',
    value: 'Build unease gradually. Let matter-of-fact description give way to implication, contradiction, and uncertainty. Avoid overexplaining mysteries; make absence, silence, and incomplete knowledge do work.',
  },
  {
    key: 'cinematic',
    label: 'Cinematic',
    value: 'Write with clear scene momentum, ensemble awareness, and strong visual composition. Balance action, political movement, and character stakes. Exposition should feel embedded in decisions and conflict.',
  },
];

interface GuidanceParameterProps {
  name: string;
  presets: GuidancePreset[];
  selectedPreset: string;
  value: string;
  placeholder: string;
  rows?: number;
  onPreset: (key: string) => void;
  onChange: (value: string) => void;
  onRefine?: () => void;
  refining?: boolean;
}

function GuidanceParameter({
  name,
  presets,
  selectedPreset,
  value,
  placeholder,
  rows = 4,
  onPreset,
  onChange,
  onRefine,
  refining = false,
}: GuidanceParameterProps) {
  return (
    <section className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-800">{name}</h2>
        <span className="text-xs text-gray-400">Prompt context</span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3 sm:grid-cols-3">
        {presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onPreset(preset.key)}
            className={`min-h-10 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${
              selectedPreset === preset.key
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {onRefine && (
        <button
          type="button"
          disabled={!value.trim() || refining}
          onClick={onRefine}
          className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Sparkles size={12} />
          {refining ? 'Refining...' : 'Refine with AI'}
        </button>
      )}
    </section>
  );
}

const presetKeyFromName = (presets: GuidancePreset[], name: string | undefined) => {
  if (!name) return '';
  const baseName = name.endsWith(' - Custom') ? name.slice(0, -' - Custom'.length) : name;
  return presets.find((preset) => preset.label === baseName)?.key ?? '';
};

const presetNameFor = (presets: GuidancePreset[], selectedKey: string, currentValue: string) => {
  const preset = presets.find((p) => p.key === selectedKey);
  if (!preset) return 'Custom';
  return currentValue.trim() === preset.value.trim() ? preset.label : `${preset.label} - Custom`;
};

const presetValueFor = (presets: GuidancePreset[], selectedKey: string) => {
  return presets.find((p) => p.key === selectedKey)?.value;
};

// ---------------------------------------------------------------------------
// Main WorldSettings component
// ---------------------------------------------------------------------------

export default function WorldSettings() {
  const { wid } = useParams<{ wid: string }>();
  const navigate = useNavigate();
  const { worlds, updateWorld, deleteWorld, addToast } = useStore();

  const world = worlds.find((w) => w.id === wid);

  const [confirmName, setConfirmName]   = useState('');
  const [deleting, setDeleting]         = useState(false);
  const [saving, setSaving]             = useState(false);

  // Style fields
  const [selectedTonePreset, setSelectedTonePreset] = useState(
    () => presetKeyFromName(TONE_PRESETS, world?.styleConfig?.tonePreset),
  );
  const [toneGuidance, setToneGuidance] = useState(world?.styleConfig?.toneGuidance ?? '');
  const [selectedVibePreset, setSelectedVibePreset] = useState(
    () => presetKeyFromName(VIBE_PRESETS, world?.styleConfig?.vibePreset),
  );
  const [vibe, setVibe]                   = useState(world?.styleConfig?.vibe ?? '');
  const [selectedWritingPreset, setSelectedWritingPreset] = useState(
    () => presetKeyFromName(WRITING_STYLE_PRESETS, world?.styleConfig?.writingStylePreset),
  );
  const [writingStyle, setWritingStyle]   = useState(world?.styleConfig?.writingStyle ?? '');
  const [inspirations, setInspirations]   = useState<string[]>(
    () => (world?.styleConfig?.inspirations ?? []).map((i) => i.name),
  );
  const [newInspirationName, setNewInspirationName] = useState('');
  const [expandingField, setExpandingField] = useState<'vibe' | 'writingStyle' | null>(null);

  // Distill state
  const [distilling, setDistilling]     = useState(false);
  const [distillPatch, setDistillPatch] = useState<{ vibe_append: string; writingStyle_append: string } | null>(null);

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
    const styleConfig: Partial<WorldStyleConfig> = {
      ...world.styleConfig,
      preset: selectedVibePreset || selectedWritingPreset || selectedTonePreset || world.styleConfig?.preset,
      tonePreset: presetNameFor(TONE_PRESETS, selectedTonePreset, toneGuidance),
      tonePresetValue: presetValueFor(TONE_PRESETS, selectedTonePreset),
      toneGuidance: toneGuidance.trim(),
      vibePreset: presetNameFor(VIBE_PRESETS, selectedVibePreset, vibe),
      vibePresetValue: presetValueFor(VIBE_PRESETS, selectedVibePreset),
      vibe: vibe.trim(),
      writingStylePreset: presetNameFor(WRITING_STYLE_PRESETS, selectedWritingPreset, writingStyle),
      writingStylePresetValue: presetValueFor(WRITING_STYLE_PRESETS, selectedWritingPreset),
      writingStyle: writingStyle.trim(),
      inspirations: inspirations.map((name) => ({ name })),
      constraints: world.styleConfig?.constraints,
    };

    try {
      await updateWorld(wid, { tone: 'custom', styleConfig });
      addToast({ message: 'Style saved.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const applyTonePreset = (key: string) => {
    const preset = TONE_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setSelectedTonePreset(key);
    setToneGuidance(preset.value);
  };

  const applyVibePreset = (key: string) => {
    const preset = VIBE_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setSelectedVibePreset(key);
    setVibe(preset.value);
  };

  const applyWritingPreset = (key: string) => {
    const preset = WRITING_STYLE_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setSelectedWritingPreset(key);
    setWritingStyle(preset.value);
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

      {/* Style config */}
      <section className="mb-10 border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">World Style</h2>
        <p className="text-xs text-gray-400 mb-5">World-level prompt context used by this world's AI generation.</p>

        <div className="flex flex-col gap-4 mb-5">
          <GuidanceParameter
            name="Writing Tone"
            presets={TONE_PRESETS}
            selectedPreset={selectedTonePreset}
            value={toneGuidance}
            placeholder="Select a preset or write the tone guidance that should steer this world's generated articles."
            rows={4}
            onPreset={applyTonePreset}
            onChange={setToneGuidance}
          />

          <GuidanceParameter
            name="Vibe & Atmosphere"
            presets={VIBE_PRESETS}
            selectedPreset={selectedVibePreset}
            value={vibe}
            placeholder="Select a preset or write the atmospheric context that should steer this world's generated articles."
            rows={4}
            onPreset={applyVibePreset}
            onChange={setVibe}
            onRefine={() => handleExpandField('vibe')}
            refining={expandingField === 'vibe'}
          />

          <GuidanceParameter
            name="Writing Style"
            presets={WRITING_STYLE_PRESETS}
            selectedPreset={selectedWritingPreset}
            value={writingStyle}
            placeholder="Select a preset or write the prose guidance that should steer this world's generated articles."
            rows={4}
            onPreset={applyWritingPreset}
            onChange={setWritingStyle}
            onRefine={() => handleExpandField('writingStyle')}
            refining={expandingField === 'writingStyle'}
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
