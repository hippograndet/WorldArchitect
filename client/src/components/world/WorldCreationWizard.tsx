import { useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { WorldTone, WorldStyleConfig, WorldStyleInspiration } from '../../types/world.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TONES: { value: WorldTone; label: string; desc: string }[] = [
  { value: 'narrative', label: 'Narrative',  desc: 'Rich, story-driven descriptions' },
  { value: 'academic',  label: 'Academic',   desc: 'Detailed, analytical, encyclopedic' },
  { value: 'terse',     label: 'Terse',      desc: 'Concise, factual entries' },
  { value: 'custom',    label: 'Custom',     desc: 'Mixed or free-form style' },
];

const PRESETS: { key: string; label: string; emoji: string; vibe: string; writingStyle: string }[] = [
  {
    key: 'epic_fantasy', label: 'Epic Fantasy', emoji: '⚔️',
    vibe: 'Grand, mythic, ancient. A world where the weight of history is felt in every stone and the stakes of every conflict echo across ages. Magic is real but costly. Heroes are forged by sacrifice.',
    writingStyle: 'Elevated, lyrical prose with long, deliberate sentences. Rich with proper nouns, lineage references, and in-world terminology. Takes itself seriously.',
  },
  {
    key: 'gritty_realism', label: 'Gritty Realism', emoji: '🗡️',
    vibe: 'Low-magic, brutal, political. Power is held by those willing to do what others won\'t. Moral ambiguity is the rule. No clean victories.',
    writingStyle: 'Sparse, close third-person POV. Short sentences under pressure. Violence is visceral and carries consequences. Avoid purple prose.',
  },
  {
    key: 'cosmic_horror', label: 'Cosmic Horror', emoji: '🌑',
    vibe: 'Vast indifference, dread, and the creeping sense that human understanding is a thin veil over an incomprehensible reality. Knowledge is dangerous. Sanity is fragile.',
    writingStyle: 'Slow-burn dread. Academic detachment giving way to growing unease. Avoid explicit description of horrors; imply and suggest.',
  },
  {
    key: 'space_opera', label: 'Space Opera', emoji: '🚀',
    vibe: 'Interstellar scale, wonder, and conflict. Empires span star systems. Individual heroes shape galactic events. Technology is indistinguishable from magic.',
    writingStyle: 'Cinematic and ensemble-driven. Fast pacing with chapter-length setpieces. Mix of action and political intrigue.',
  },
  {
    key: 'custom', label: 'Custom', emoji: '✏️',
    vibe: '',
    writingStyle: '',
  },
];

interface Inspiration {
  name: string;
  expandedDescription: string;
  expanding: boolean;
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

export default function WorldCreationWizard() {
  const navigate = useNavigate();
  const { createWorld, updateWorld, addToast } = useStore();

  // Step 1
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [creatingWorld, setCreatingWorld] = useState(false);

  // Created world info (set after Step 1 completes)
  const [worldId, setWorldId]         = useState<string | null>(null);
  const [rootArticleId, setRootArticleId] = useState<string | null>(null);

  // Step 2
  const [tone, setTone]               = useState<WorldTone>('narrative');
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [vibe, setVibe]               = useState('');
  const [writingStyle, setWritingStyle] = useState('');
  const [inspirations, setInspirations] = useState<Inspiration[]>([]);
  const [inspirationInput, setInspirationInput] = useState('');
  const [expandingVibe, setExpandingVibe] = useState(false);
  const [expandingStyle, setExpandingStyle] = useState(false);
  const [savingStyle, setSavingStyle]   = useState(false);

  const [step, setStep] = useState<1 | 2>(1);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const step1Valid = name.trim().length > 0 && description.trim().length >= 20;
  const inspirationsReady = inspirations.every((i) => i.expandedDescription.length > 0 && !i.expanding);
  const step2HasStyle = vibe.trim().length > 0 || selectedPreset !== '';

  // ---------------------------------------------------------------------------
  // Step 1: create world
  // ---------------------------------------------------------------------------

  const handleCreateWorld = async () => {
    if (!step1Valid || creatingWorld) return;
    setCreatingWorld(true);
    try {
      const { world, rootArticleId: rid } = await createWorld({
        name: name.trim(),
        description: description.trim(),
      });
      setWorldId(world.id);
      setRootArticleId(rid);
      setStep(2);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setCreatingWorld(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step 2: helpers
  // ---------------------------------------------------------------------------

  const applyPreset = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setSelectedPreset(key);
    setVibe(preset.vibe);
    setWritingStyle(preset.writingStyle);
  };

  const callPromptEngineer = async (
    fieldType: 'vibe' | 'writing_style' | 'inspiration',
    rawText: string,
  ): Promise<string> => {
    const result = await api.worlds.promptEngineer({
      fieldType,
      rawText,
      worldName: name.trim(),
      worldDescription: description.trim(),
      wid: worldId ?? undefined,
    });
    return result.expandedDescription;
  };

  const handleExpandVibe = async () => {
    if (!vibe.trim()) return;
    setExpandingVibe(true);
    try { setVibe(await callPromptEngineer('vibe', vibe)); }
    catch (err) { addToast({ message: (err as Error).message, type: 'error' }); }
    finally { setExpandingVibe(false); }
  };

  const handleExpandStyle = async () => {
    if (!writingStyle.trim()) return;
    setExpandingStyle(true);
    try { setWritingStyle(await callPromptEngineer('writing_style', writingStyle)); }
    catch (err) { addToast({ message: (err as Error).message, type: 'error' }); }
    finally { setExpandingStyle(false); }
  };

  const handleAddInspiration = () => {
    const trimmed = inspirationInput.trim();
    if (!trimmed) return;
    setInspirations((prev) => [...prev, { name: trimmed, expandedDescription: '', expanding: false }]);
    setInspirationInput('');
  };

  const handleExpandInspiration = async (idx: number) => {
    const ins = inspirations[idx];
    if (!ins || ins.expanding) return;
    setInspirations((prev) => prev.map((i, j) => j === idx ? { ...i, expanding: true } : i));
    try {
      const expanded = await callPromptEngineer('inspiration', ins.name);
      setInspirations((prev) => prev.map((i, j) =>
        j === idx ? { ...i, expandedDescription: expanded, expanding: false } : i,
      ));
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
      setInspirations((prev) => prev.map((i, j) => j === idx ? { ...i, expanding: false } : i));
    }
  };

  const handleRemoveInspiration = (idx: number) => {
    setInspirations((prev) => prev.filter((_, j) => j !== idx));
  };

  // ---------------------------------------------------------------------------
  // Step 2: save style + navigate
  // ---------------------------------------------------------------------------

  const navigateToWorld = () => {
    if (!worldId || !rootArticleId) return;
    navigate(`/worlds/${worldId}/articles/${rootArticleId}`);
  };

  const handleFinish = async () => {
    if (!worldId || !inspirationsReady || savingStyle) return;
    setSavingStyle(true);

    const styleConfig: Partial<WorldStyleConfig> = {
      preset: selectedPreset || undefined,
      vibe: vibe.trim(),
      writingStyle: writingStyle.trim(),
      inspirations: inspirations
        .filter((i) => i.expandedDescription.length > 0)
        .map((i): WorldStyleInspiration => ({ name: i.name, expandedDescription: i.expandedDescription })),
    };

    try {
      await updateWorld(worldId, { tone, styleConfig });
      navigateToWorld();
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
      setSavingStyle(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center py-16 px-4">
      <div className="w-full max-w-xl">
        {step === 1 && (
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 mb-6 flex items-center gap-1">
            <ArrowLeft size={14} /> Back
          </button>
        )}

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Create a new world</h1>
        <p className="text-sm text-gray-500 mb-6">
          {step === 1
            ? 'Name and describe your world.'
            : 'Set its style to guide AI generation. You can always edit this later.'}
        </p>

        {/* Step indicator */}
        <div className="flex gap-2 mb-8">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${step >= s ? 'bg-blue-500' : 'bg-gray-200'}`}
            />
          ))}
        </div>

        {/* ---- STEP 1: Identity ---- */}
        {step === 1 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">World name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aethon, The Shattered Realm…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description * <span className="text-gray-400 font-normal">(20 chars min)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe the world's premise, themes, and setting. Include anything that defines its identity — setting, conflicts, key concepts, tone…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">{description.length} chars</p>
            </div>

            <button
              type="button"
              disabled={!step1Valid || creatingWorld}
              onClick={handleCreateWorld}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center justify-center gap-1.5">
                {creatingWorld ? 'Creating…' : <><ArrowRight size={14} /> Next: World Style</>}
              </span>
            </button>
          </div>
        )}

        {/* ---- STEP 2: Style ---- */}
        {step === 2 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col gap-5">

            {/* Tone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Writing tone</label>
              <div className="grid grid-cols-2 gap-2">
                {TONES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTone(t.value)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      tone === t.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Presets */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Style preset <span className="text-gray-400 font-normal">(optional)</span></p>
              <p className="text-xs text-gray-400 mb-2">Pre-fills the fields below. You can customise after selecting.</p>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p.key)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      selectedPreset === p.key
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-lg mb-0.5">{p.emoji}</div>
                    <div className="text-xs font-medium text-gray-800">{p.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Vibe */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Vibe & Atmosphere <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={vibe}
                onChange={(e) => setVibe(e.target.value)}
                rows={3}
                placeholder="e.g. gritty, low-magic, industrial…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                disabled={!vibe.trim() || expandingVibe}
                onClick={handleExpandVibe}
                className="mt-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {expandingVibe ? 'Expanding…' : '✦ Expand with AI'}
              </button>
            </div>

            {/* Writing style */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Writing Style <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={writingStyle}
                onChange={(e) => setWritingStyle(e.target.value)}
                rows={3}
                placeholder="e.g. sparse, close POV, terse sentences…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                disabled={!writingStyle.trim() || expandingStyle}
                onClick={handleExpandStyle}
                className="mt-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {expandingStyle ? 'Expanding…' : '✦ Expand with AI'}
              </button>
            </div>

            {/* Inspirations */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Inspirations <span className="text-gray-400 font-normal">(optional — expand each before finishing)</span>
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  value={inspirationInput}
                  onChange={(e) => setInspirationInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddInspiration())}
                  placeholder="e.g. Game of Thrones, Dune…"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleAddInspiration}
                  disabled={!inspirationInput.trim()}
                  className="px-3 py-2 text-sm bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {inspirations.length > 0 && (
                <div className="flex flex-col gap-2">
                  {inspirations.map((ins, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded-lg border text-xs ${ins.expandedDescription ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-800">{ins.name}</span>
                        <button type="button" onClick={() => handleRemoveInspiration(idx)} className="text-gray-400 hover:text-gray-700"><X size={14} /></button>
                      </div>
                      {ins.expandedDescription
                        ? <p className="text-gray-600 leading-relaxed line-clamp-3">{ins.expandedDescription}</p>
                        : (
                          <button
                            type="button"
                            disabled={ins.expanding}
                            onClick={() => handleExpandInspiration(idx)}
                            className="text-blue-600 hover:text-blue-800 disabled:opacity-40"
                          >
                            {ins.expanding ? 'Expanding…' : '✦ Expand with AI (required before saving)'}
                          </button>
                        )
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!inspirationsReady && inspirations.length > 0 && (
              <p className="text-xs text-amber-600 -mt-2">Expand all inspirations before finishing.</p>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={!inspirationsReady || savingStyle}
                onClick={handleFinish}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="flex items-center justify-center gap-1.5">
                  {savingStyle ? 'Saving…' : step2HasStyle ? 'Finish — Save Style' : 'Finish'}
                </span>
              </button>
              <button
                type="button"
                onClick={navigateToWorld}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600"
              >
                <span className="flex items-center justify-center gap-1">Skip style for now <ArrowRight size={14} /></span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
