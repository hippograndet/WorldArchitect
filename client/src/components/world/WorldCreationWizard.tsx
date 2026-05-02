import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import type { WorldTone } from '../../types/world.ts';

const TONES: { value: WorldTone; label: string; desc: string }[] = [
  { value: 'narrative', label: 'Narrative',  desc: 'Rich, story-driven descriptions' },
  { value: 'academic',  label: 'Academic',   desc: 'Detailed, analytical, encyclopedic' },
  { value: 'terse',     label: 'Terse',      desc: 'Concise, factual entries' },
  { value: 'custom',    label: 'Custom',     desc: 'Mixed or free-form style' },
];

export default function WorldCreationWizard() {
  const navigate = useNavigate();
  const { createWorld, addToast } = useStore();

  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [tone, setTone]               = useState<WorldTone>('narrative');
  const [originPoint, setOriginPoint] = useState('');
  const [tags, setTags]               = useState('');
  const [generateStubs, setGenerateStubs] = useState(false);
  const [loading, setLoading]         = useState(false);

  const valid = name.trim().length > 0 && description.trim().length >= 20;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || loading) return;

    setLoading(true);
    try {
      const { world, rootArticleId } = await createWorld({
        name: name.trim(),
        description: description.trim(),
        tone,
        originPoint: originPoint.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        generateStubs,
      });
      navigate(`/worlds/${world.id}/articles/${rootArticleId}`);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center py-16 px-4">
      <div className="w-full max-w-xl">
        <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 mb-6">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Create a new world</h1>
        <p className="text-sm text-gray-500 mb-8">Describe your world to seed the encyclopedia.</p>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col gap-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">World name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aethon, The Shattered Realm…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description * <span className="text-gray-400 font-normal">(20 chars min)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Describe the world's premise, themes, and setting…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">{description.length} chars</p>
          </div>

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

          {/* Origin point */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Origin point <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              value={originPoint}
              onChange={(e) => setOriginPoint(e.target.value)}
              placeholder="e.g. Year 0, The First Age…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags <span className="text-gray-400 font-normal">(optional, comma-separated)</span>
            </label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="fantasy, political, magic-system…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* AI stub generation — opt-in */}
          <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
            <input
              type="checkbox"
              checked={generateStubs}
              onChange={(e) => setGenerateStubs(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm font-medium text-gray-700">Generate initial article stubs with AI</div>
              <div className="text-xs text-gray-400 mt-0.5">Uses the Skeleton Agent to populate starting articles from your description. Requires an LLM provider configured in Settings.</div>
            </div>
          </label>

          <button
            type="submit"
            disabled={!valid || loading}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating world…' : 'Create World'}
          </button>
        </form>
      </div>
    </div>
  );
}
