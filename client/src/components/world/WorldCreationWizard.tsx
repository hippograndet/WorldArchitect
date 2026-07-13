import { FormEvent, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Landmark, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api, type CharterAssistResponse } from '../../lib/api.ts';
import type { WorldStyleConfig } from '../../types/world.ts';

interface CharterPreset {
  key: string;
  label: string;
}

const PREMISE_PRESETS: CharterPreset[] = [
  { key: 'civilization', label: 'Civilization' },
  { key: 'conflict', label: 'Conflict' },
  { key: 'mythology', label: 'Mythology' },
  { key: 'frontier', label: 'Frontier' },
];

const AUTHORITY_PRESETS: CharterPreset[] = [
  { key: 'neutral_reference', label: 'Neutral Reference' },
  { key: 'official_archive', label: 'Official Archive' },
  { key: 'field_notes', label: 'Field Notes' },
  { key: 'oral_history', label: 'Oral History' },
];

const ATMOSPHERE_PRESETS: CharterPreset[] = [
  { key: 'epic_fantasy', label: 'Epic Fantasy' },
  { key: 'gritty_realism', label: 'Gritty Realism' },
  { key: 'cosmic_horror', label: 'Cosmic Horror' },
  { key: 'space_opera', label: 'Space Opera' },
];

const PROSE_PRESETS: CharterPreset[] = [
  { key: 'elevated', label: 'Elevated' },
  { key: 'lean_visceral', label: 'Lean & Visceral' },
  { key: 'slow_dread', label: 'Slow Dread' },
  { key: 'cinematic', label: 'Cinematic' },
];

const ARCHITECTURE_PRESETS: CharterPreset[] = [
  { key: 'basic', label: 'Basic' },
];

interface CharterPresetButtonsProps {
  presets: CharterPreset[];
  selectedPreset: string;
  onPreset: (key: string) => void;
}

function CharterPresetButtons({ presets, selectedPreset, onPreset }: CharterPresetButtonsProps) {
  return (
    <>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Presets</p>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onPreset(preset.key)}
            className={`min-h-11 rounded-md border px-3 py-2 text-left text-xs font-semibold transition-colors ${
              selectedPreset === preset.key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </>
  );
}

interface CharterTextFieldProps {
  name: string;
  summary: string;
  presets: CharterPreset[];
  selectedPreset: string;
  value: string;
  placeholder: string;
  recommendation: string;
  rows?: number;
  id?: string;
  className?: string;
  headerMeta?: ReactNode;
  onPreset: (key: string) => void;
  onChange: (value: string) => void;
  onRefine?: () => void;
  refining?: boolean;
}

function CharterTextField({
  name,
  summary,
  presets,
  selectedPreset,
  value,
  placeholder,
  recommendation,
  rows = 4,
  id,
  className = 'border-t border-gray-200 pt-6',
  headerMeta,
  onPreset,
  onChange,
  onRefine,
  refining = false,
}: CharterTextFieldProps) {
  return (
    <section className={className}>
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <label htmlFor={id} className="text-sm font-semibold text-gray-950">
          {name} <span className="font-normal text-gray-500">- {summary}</span>
        </label>
        {headerMeta}
        {!headerMeta && onRefine && (
          <button
            type="button"
            disabled={!value.trim() || refining}
            onClick={onRefine}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles size={13} aria-hidden="true" />
            {refining ? 'Refining...' : 'Refine'}
          </button>
        )}
      </div>

      <CharterPresetButtons presets={presets} selectedPreset={selectedPreset} onPreset={onPreset} />

      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
      />
      <p className="mt-2 text-xs leading-5 text-gray-500">Recommended range: {recommendation}</p>
    </section>
  );
}

interface ArchitectureFieldProps {
  selectedPreset: string;
  onPreset: (key: string) => void;
}

function ArchitectureField({ selectedPreset, onPreset }: ArchitectureFieldProps) {
  return (
    <section className="border-t border-gray-200 pt-6">
      <h2 className="mb-3 text-sm font-semibold text-gray-950">
        Bible foundational architecture <span className="font-normal text-gray-500">- How the world begins</span>
      </h2>
      <CharterPresetButtons presets={ARCHITECTURE_PRESETS} selectedPreset={selectedPreset} onPreset={onPreset} />
      <div className="rounded-md border border-gray-300 bg-gray-50 px-3 py-3 text-sm leading-6 text-gray-700 shadow-sm">
        Basic creates one root article. The founding premise becomes the stem of that article's introduction and the first World Bible entry, matching the current creation flow.
      </div>
    </section>
  );
}

interface SuggestionGroupProps {
  title: string;
  suggestions: string[];
  onApply: (suggestion: string) => void;
}

function SuggestionGroup({ title, suggestions, onApply }: SuggestionGroupProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {suggestions.map((suggestion, index) => (
          <button
            key={`${title}-${suggestion}-${index}`}
            type="button"
            onClick={() => onApply(suggestion)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50"
          >
            <Check size={12} aria-hidden="true" />
            <span className="truncate">{suggestion}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function WorldCreationWizard() {
  const navigate = useNavigate();
  const { createWorld, addToast } = useStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPremisePreset, setSelectedPremisePreset] = useState('');
  const [selectedTonePreset, setSelectedTonePreset] = useState('');
  const [toneGuidance, setToneGuidance] = useState('');
  const [selectedVibePreset, setSelectedVibePreset] = useState('');
  const [selectedWritingPreset, setSelectedWritingPreset] = useState('');
  const [vibe, setVibe] = useState('');
  const [writingStyle, setWritingStyle] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [charterSuggestions, setCharterSuggestions] = useState<CharterAssistResponse | null>(null);
  const [assistingCharter, setAssistingCharter] = useState(false);
  const [expandingVibe, setExpandingVibe] = useState(false);
  const [expandingStyle, setExpandingStyle] = useState(false);
  const [selectedArchitecturePreset, setSelectedArchitecturePreset] = useState('basic');
  const [creating, setCreating] = useState(false);

  const valid = name.trim().length > 0 && description.trim().length >= 20;

  const applyPreset = (presets: CharterPreset[], key: string, select: (key: string) => void) => {
    if (!presets.some((p) => p.key === key)) return;
    select(key);
  };

  const presetNameFor = (presets: CharterPreset[], selectedKey: string, currentValue: string) => {
    const preset = presets.find((p) => p.key === selectedKey);
    if (!preset) return 'Custom';
    return currentValue.trim() ? `${preset.label} - Custom` : preset.label;
  };

  const handleExpandVibe = async () => {
    if (!vibe.trim()) return;
    setExpandingVibe(true);
    try {
      const result = await api.worlds.promptEngineer({
        fieldType: 'vibe',
        rawText: vibe,
        worldName: name.trim() || 'Untitled world',
        worldDescription: description.trim() || '(not set)',
      });
      if ('expandedDescription' in result) setVibe(result.expandedDescription);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setExpandingVibe(false);
    }
  };

  const handleExpandStyle = async () => {
    if (!writingStyle.trim()) return;
    setExpandingStyle(true);
    try {
      const result = await api.worlds.promptEngineer({
        fieldType: 'writing_style',
        rawText: writingStyle,
        worldName: name.trim() || 'Untitled world',
        worldDescription: description.trim() || '(not set)',
      });
      if ('expandedDescription' in result) setWritingStyle(result.expandedDescription);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setExpandingStyle(false);
    }
  };

  const handleCharterAssist = async () => {
    if (!stylePrompt.trim() || assistingCharter) return;
    setAssistingCharter(true);
    setCharterSuggestions(null);
    try {
      const result = await api.worlds.promptEngineer({
        fieldType: 'charter_assist',
        rawText: stylePrompt,
        worldName: name.trim() || 'Untitled world',
        worldDescription: description.trim() || '(not set)',
        currentAuthority: toneGuidance,
        currentVibe: vibe,
        currentWritingStyle: writingStyle,
      });
      if ('premiseSuggestions' in result) setCharterSuggestions(result);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setAssistingCharter(false);
    }
  };

  const appendSuggestion = (current: string, suggestion: string) => {
    const trimmed = current.trim();
    if (!trimmed) return suggestion;
    return `${trimmed}; ${suggestion}`;
  };

  const buildStyleConfig = (): Partial<WorldStyleConfig> => ({
    preset: selectedVibePreset || selectedWritingPreset || selectedTonePreset || undefined,
    tonePreset: presetNameFor(AUTHORITY_PRESETS, selectedTonePreset, toneGuidance),
    toneGuidance: toneGuidance.trim(),
    vibePreset: presetNameFor(ATMOSPHERE_PRESETS, selectedVibePreset, vibe),
    vibe: vibe.trim(),
    writingStylePreset: presetNameFor(PROSE_PRESETS, selectedWritingPreset, writingStyle),
    writingStyle: writingStyle.trim(),
    inspirations: [],
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || creating) return;
    setCreating(true);

    try {
      const { world, rootArticleId } = await createWorld({
        name: name.trim(),
        description: description.trim(),
        tone: 'custom',
        styleConfig: buildStyleConfig(),
      });
      navigate(`/worlds/${world.id}/articles/${rootArticleId}`);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 shadow-sm hover:bg-gray-50 hover:text-gray-950"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Worlds
        </button>

        <header className="border-b border-gray-300 pb-8">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 shadow-sm">
              <Landmark size={14} className="text-slate-700" aria-hidden="true" />
              World Charter
            </div>
            <h1 className="text-4xl font-bold tracking-normal text-gray-950 sm:text-5xl">Create a world</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600">
              Establish the official record: premise, voice, atmosphere, prose style, and foundational architecture.
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <main className="rounded-lg border border-gray-300 bg-white p-5 shadow-sm sm:p-7">
            <section className="grid gap-5">
              <div>
                <label htmlFor="world-name" className="block text-sm font-semibold text-gray-950">
                  World name
                </label>
                <input
                  id="world-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder=""
                  className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-3 text-base font-semibold text-gray-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <CharterTextField
                id="world-description"
                name="Founding premise"
                summary="Core truths and founding tensions"
                presets={PREMISE_PRESETS}
                selectedPreset={selectedPremisePreset}
                value={description}
                placeholder="Define what is true about the world itself: where it is, who lives there, what powers or systems shape it, what conflicts matter, what history casts a shadow, and what the root article must establish. This is lore and premise, not writing style."
                recommendation="80-180 words, or 6-12 decisive facts."
                rows={7}
                className=""
                headerMeta={<span className="text-xs font-medium text-gray-400">{description.length} chars</span>}
                onPreset={(key) => applyPreset(PREMISE_PRESETS, key, setSelectedPremisePreset)}
                onChange={setDescription}
              />
            </section>

            <CharterTextField
              name="Narrative authority"
              summary="Source and authority of record"
              presets={AUTHORITY_PRESETS}
              selectedPreset={selectedTonePreset}
              value={toneGuidance}
              placeholder="Define the source and authority behind the encyclopedia: neutral reference work, state archive, field researcher, oral tradition, secret dossier, unreliable scholar, or another record-keeping stance. This controls who appears to be speaking and how certain the record sounds. It does not define sentence rhythm, vocabulary density, or literary style."
              recommendation="1-3 sentences, or 3-6 authority keywords."
              rows={4}
              onPreset={(key) => applyPreset(AUTHORITY_PRESETS, key, setSelectedTonePreset)}
              onChange={setToneGuidance}
            />

            <CharterTextField
              name="Atmosphere"
              summary="Mood, stakes, and genre pressure"
              presets={ATMOSPHERE_PRESETS}
              selectedPreset={selectedVibePreset}
              value={vibe}
              placeholder="Describe the world's dominant mood and genre forces: dread or wonder, scarcity or abundance, myth or realism, cosmic scale or local intimacy, clean heroism or moral compromise. Define the pressure the setting puts on people."
              recommendation="2-4 sentences, or 5-10 atmosphere keywords."
              rows={4}
              onPreset={(key) => applyPreset(ATMOSPHERE_PRESETS, key, setSelectedVibePreset)}
              onChange={setVibe}
              onRefine={handleExpandVibe}
              refining={expandingVibe}
            />

            <CharterTextField
              name="Prose style"
              summary="Sentence rhythm and diction rules"
              presets={PROSE_PRESETS}
              selectedPreset={selectedWritingPreset}
              value={writingStyle}
              placeholder="Define how the text should be written on the page: plain or lyrical, dense or spare, formal or conversational, fast or measured, metaphor-heavy or concrete, terse or elaborate. This controls sentence rhythm, diction, paragraph shape, and exposition habits. It does not decide who authored the record."
              recommendation="2-4 sentences, or 5-10 prose rules."
              rows={4}
              onPreset={(key) => applyPreset(PROSE_PRESETS, key, setSelectedWritingPreset)}
              onChange={setWritingStyle}
              onRefine={handleExpandStyle}
              refining={expandingStyle}
            />

            <ArchitectureField
              selectedPreset={selectedArchitecturePreset}
              onPreset={(key) => applyPreset(ARCHITECTURE_PRESETS, key, setSelectedArchitecturePreset)}
            />
          </main>

          <aside className="flex flex-col gap-4">
            <section className="rounded-lg border border-gray-300 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
                  <Sparkles size={18} aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">Style prompt engineer</h2>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Cite inspirations, moods, or keywords; suggestions will abstract them into original charter language.
                  </p>
                </div>
              </div>

              <textarea
                value={stylePrompt}
                onChange={(e) => setStylePrompt(e.target.value)}
                rows={5}
                placeholder="Example: I want keywords for a gritty, dark world inspired by cyberpunk power structures and dynastic betrayal. Keep it political, grounded, and tense."
                className="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
              <button
                type="button"
                disabled={!stylePrompt.trim() || assistingCharter}
                onClick={handleCharterAssist}
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Sparkles size={13} aria-hidden="true" />
                {assistingCharter ? 'Thinking...' : 'Suggest charter language'}
              </button>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                Suggestions are not saved as context and should not copy named concepts from cited works.
              </p>
            </section>

            {charterSuggestions && (
              <section className="rounded-lg border border-slate-300 bg-slate-50 p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-950">Suggested language</h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">{charterSuggestions.rationale}</p>

                <SuggestionGroup
                  title="Founding premise"
                  suggestions={charterSuggestions.premiseSuggestions}
                  onApply={(suggestion) => setDescription((value) => appendSuggestion(value, suggestion))}
                />
                <SuggestionGroup
                  title="Narrative authority"
                  suggestions={charterSuggestions.authoritySuggestions}
                  onApply={(suggestion) => setToneGuidance((value) => appendSuggestion(value, suggestion))}
                />
                <SuggestionGroup
                  title="Atmosphere"
                  suggestions={charterSuggestions.atmosphereSuggestions}
                  onApply={(suggestion) => setVibe((value) => appendSuggestion(value, suggestion))}
                />
                <SuggestionGroup
                  title="Prose style"
                  suggestions={charterSuggestions.proseSuggestions}
                  onApply={(suggestion) => setWritingStyle((value) => appendSuggestion(value, suggestion))}
                />
              </section>
            )}

            <section className="rounded-lg border border-gray-300 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-950">Create record</h2>
              <dl className="mt-4 grid gap-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">Name</dt>
                  <dd className="max-w-[180px] truncate font-semibold text-gray-900">{name.trim() || 'Required'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">Premise</dt>
                  <dd className={description.trim().length >= 20 ? 'font-semibold text-gray-900' : 'font-semibold text-amber-700'}>
                    {description.trim().length >= 20 ? 'Ready' : '20 chars min'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">Style fields</dt>
                  <dd className="font-semibold text-gray-900">
                    {[toneGuidance, vibe, writingStyle].filter((v) => v.trim()).length}/3
                  </dd>
                </div>
              </dl>
              <button
                type="submit"
                disabled={!valid || creating}
                className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {creating ? 'Creating...' : 'Create world'}
              </button>
            </section>
          </aside>
        </form>
      </div>
    </div>
  );
}
