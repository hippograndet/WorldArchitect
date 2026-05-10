import { useState } from 'react';
import { ArrowLeft, ArrowRight, X, Sparkles } from 'lucide-react';
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
  const [inspirations, setInspirations] = useState<WorldStyleInspiration[]>([]);
  const [inspirationInput, setInspirationInput] = useState('');
  const [expandingVibe, setExpandingVibe] = useState(false);
  const [expandingStyle, setExpandingStyle] = useState(false);
  const [distilling, setDistilling]   = useState(false);
  const [distillPatch, setDistillPatch] = useState<{ vibe_append: string; writingStyle_append: string } | null>(null);
  const [savingStyle, setSavingStyle]   = useState(false);

  const [step, setStep] = useState<1 | 2>(1);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const step1Valid = name.trim().length > 0 && description.trim().length >= 20;
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

  const handleExpandVibe = async () => {
    if (!vibe.trim()) return;
    setExpandingVibe(true);
    try {
      const result = await api.worlds.promptEngineer({
        fieldType: 'vibe', rawText: vibe,
        worldName: name.trim(), worldDescription: description.trim(),
        wid: worldId ?? undefined,
      });
      if ('expandedDescription' in result) setVibe(result.expandedDescription);
    } catch (err) { addToast({ message: (err as Error).message, type: 'error' }); }
    finally { setExpandingVibe(false); }
  };

  const handleExpandStyle = async () => {
    if (!writingStyle.trim()) return;
    setExpandingStyle(true);
    try {
      const result = await api.worlds.promptEngineer({
        fieldType: 'writing_style', rawText: writingStyle,
        worldName: name.trim(), worldDescription: description.trim(),
        wid: worldId ?? undefined,
      });
      if ('expandedDescription' in result) setWritingStyle(result.expandedDescription);
    } catch (err) { addToast({ message: (err as Error).message, type: 'error' }); }
    finally { setExpandingStyle(false); }
  };

  const handleAddInspiration = () => {
    const trimmed = inspirationInput.trim();
    if (!trimmed) return;
    setInspirations((prev) => [...prev, { name: trimmed }]);
    setInspirationInput('');
  };

  const handleDistill = async () => {
    if (!inspirations.length || distilling) return;
    setDistilling(true);
    setDistillPatch(null);
    try {
      const rawText = inspirations.map((i) => i.name).join(', ');
      const result = await api.worlds.promptEngineer({
        fieldType: 'distill', rawText,
        worldName: name.trim(), worldDescription: description.trim(),
        currentVibe: vibe, currentWritingStyle: writingStyle,
        wid: worldId ?? undefined,
      });
      if ('vibe_append' in result) setDistillPatch(result);
    } catch (err) { addToast({ message: (err as Error).message, type: 'error' }); }
    finally { setDistilling(false); }
  };

  const handleApplyPatch = () => {
    if (!distillPatch) return;
    if (distillPatch.vibe_append) setVibe((v) => v ? `${v} ${distillPatch.vibe_append}` : distillPatch.vibe_append);
    if (distillPatch.writingStyle_append) setWritingStyle((s) => s ? `${s} ${distillPatch.writingStyle_append}` : distillPatch.writingStyle_append);
    setDistillPatch(null);
  };

  // ---------------------------------------------------------------------------
  // Step 2: save style + navigate
  // ---------------------------------------------------------------------------

  const navigateToWorld = () => {
    if (!worldId || !rootArticleId) return;
    navigate(`/worlds/${worldId}/articles/${rootArticleId}`);
  };

  const handleFinish = async () => {
    if (!worldId || savingStyle) return;
    setSavingStyle(true);

    const styleConfig: Partial<WorldStyleConfig> = {
      preset: selectedPreset || undefined,
      vibe: vibe.trim(),
      writingStyle: writingStyle.trim(),
      inspirations: inspirations,
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
                Inspirations <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <p className="text-xs text-gray-400 mb-2">Add works that inspired this world. Use "Distill to Style" to absorb their feel into your Vibe & Writing Style fields.</p>
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
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {inspirations.map((ins, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-50 border border-purple-200 text-xs text-purple-800"
                    >
                      {ins.name}
                      <button type="button" onClick={() => setInspirations((p) => p.filter((_, j) => j !== idx))} className="hover:text-purple-500 ml-0.5">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {inspirations.length > 0 && (
                <button
                  type="button"
                  disabled={distilling}
                  onClick={handleDistill}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-lg hover:bg-purple-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Sparkles size={12} />
                  {distilling ? 'Distilling…' : '✦ Distill to Style'}
                </button>
              )}
            </div>

            {/* Distill patch preview */}
            {distillPatch && (
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 flex flex-col gap-3 text-xs">
                <p className="font-medium text-purple-800">Style additions — review before applying</p>
                {distillPatch.vibe_append && (
                  <div>
                    <p className="text-purple-600 uppercase tracking-wide font-medium mb-1">Vibe addition</p>
                    <p className="text-gray-700 leading-relaxed">{distillPatch.vibe_append}</p>
                  </div>
                )}
                {distillPatch.writingStyle_append && (
                  <div>
                    <p className="text-purple-600 uppercase tracking-wide font-medium mb-1">Writing Style addition</p>
                    <p className="text-gray-700 leading-relaxed">{distillPatch.writingStyle_append}</p>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleApplyPatch}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-xs font-medium"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setDistillPatch(null)}
                    className="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-xs"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={savingStyle}
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
