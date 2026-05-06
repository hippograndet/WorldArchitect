import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import type { WorldStyleInspiration, VisualTheme } from '../../types/world.ts';

// ---------------------------------------------------------------------------
// Inspiration chip with expand button
// ---------------------------------------------------------------------------

interface InspirationChipProps {
  wid: string;
  worldName: string;
  worldDescription: string;
  item: WorldStyleInspiration & { expanded: boolean };
  onExpand: (expanded: string) => void;
  onRemove: () => void;
}

function InspirationChip({ wid, worldName, worldDescription, item, onExpand, onRemove }: InspirationChipProps) {
  const [expanding, setExpanding] = useState(false);

  const handleExpand = async () => {
    setExpanding(true);
    try {
      const { expandedDescription } = await api.worlds.promptEngineer({
        fieldType: 'inspiration',
        rawText: item.name,
        worldName,
        worldDescription,
        wid,
      });
      onExpand(expandedDescription);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setExpanding(false);
    }
  };

  return (
    <div className={`border rounded-lg p-2.5 text-xs ${item.expanded ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-medium text-gray-800 truncate">{item.name}</span>
        <div className="flex items-center gap-1 shrink-0">
          {!item.expanded && (
            <button
              onClick={handleExpand}
              disabled={expanding}
              className="px-2 py-0.5 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 disabled:opacity-50"
            >
              {expanding ? '…' : '✦ Expand'}
            </button>
          )}
          {item.expanded && (
            <button
              onClick={handleExpand}
              disabled={expanding}
              className="px-2 py-0.5 text-purple-600 border border-purple-300 rounded text-xs hover:bg-purple-50 disabled:opacity-50"
            >
              {expanding ? '…' : '↺'}
            </button>
          )}
          <button onClick={onRemove} className="text-gray-400 hover:text-red-500 px-1">×</button>
        </div>
      </div>
      {item.expanded && (
        <p className="text-gray-500 text-xs leading-relaxed line-clamp-3">{item.expandedDescription}</p>
      )}
      {!item.expanded && (
        <p className="text-amber-600 text-xs">Needs AI expansion before saving</p>
      )}
    </div>
  );
}

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
  const [vibe, setVibe]                   = useState(world?.styleConfig?.vibe ?? '');
  const [writingStyle, setWritingStyle]   = useState(world?.styleConfig?.writingStyle ?? '');
  const [inspirations, setInspirations]   = useState<(WorldStyleInspiration & { expanded: boolean })[]>(
    () => (world?.styleConfig?.inspirations ?? []).map((i) => ({ ...i, expanded: true })),
  );
  const [newInspirationName, setNewInspirationName] = useState('');
  const [expandingField, setExpandingField] = useState<'vibe' | 'writingStyle' | null>(null);
  const [visualTheme, setVisualTheme] = useState<VisualTheme>(world?.styleConfig?.visualTheme ?? 'default');

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

  const canSaveStyle = inspirations.every((i) => i.expanded);

  const handleSaveStyle = async () => {
    if (!wid || !canSaveStyle || saving) return;
    setSaving(true);
    try {
      await updateWorld(wid, {
        styleConfig: {
          vibe,
          writingStyle,
          inspirations: inspirations.map(({ name, expandedDescription }) => ({ name, expandedDescription })),
          constraints: world.styleConfig?.constraints,
          visualTheme: visualTheme !== 'default' ? visualTheme : undefined,
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
      const { expandedDescription } = await api.worlds.promptEngineer({
        fieldType: apiFieldType,
        rawText,
        worldName: world.name,
        worldDescription: world.description,
        wid,
      });
      if (fieldType === 'vibe') setVibe(expandedDescription);
      else setWritingStyle(expandedDescription);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setExpandingField(null);
    }
  };

  const handleAddInspiration = () => {
    const name = newInspirationName.trim();
    if (!name || inspirations.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    setInspirations((prev) => [...prev, { name, expandedDescription: '', expanded: false }]);
    setNewInspirationName('');
  };

  return (
    <div className="max-w-xl mx-auto py-10 px-6">
      <Link to={`/worlds/${wid ?? ''}`} className="text-sm text-gray-400 hover:text-gray-700">← Back</Link>

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
          <div className="flex flex-col gap-2 mb-2">
            {inspirations.map((item, idx) => (
              <InspirationChip
                key={item.name}
                wid={wid!}
                worldName={world.name}
                worldDescription={world.description}
                item={item}
                onExpand={(expanded) =>
                  setInspirations((prev) =>
                    prev.map((p, i) => i === idx ? { ...p, expandedDescription: expanded, expanded: true } : p),
                  )
                }
                onRemove={() => setInspirations((prev) => prev.filter((_, i) => i !== idx))}
              />
            ))}
          </div>
          <div className="flex gap-2">
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
        </div>

        {/* Visual theme */}
        <div className="mb-5">
          <label className="text-xs font-medium text-gray-700 block mb-2">Visual Theme</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'default',      label: 'Default',       desc: 'Clean & minimal' },
              { value: 'arcane_scroll', label: 'Arcane Scroll', desc: 'Parchment fantasy' },
              { value: 'data_link',    label: 'Data-Link',     desc: 'Dark sci-fi' },
              { value: 'dossier',      label: 'The Dossier',   desc: 'Typewriter noir' },
            ] as { value: VisualTheme; label: string; desc: string }[]).map((t) => (
              <label
                key={t.value}
                className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  visualTheme === t.value
                    ? 'border-purple-400 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="visualTheme"
                  value={t.value}
                  checked={visualTheme === t.value}
                  onChange={() => setVisualTheme(t.value)}
                  className="mt-0.5 accent-purple-600"
                />
                <div>
                  <p className="text-xs font-medium text-gray-800">{t.label}</p>
                  <p className="text-xs text-gray-400">{t.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {!canSaveStyle && (
          <p className="text-xs text-amber-600 mb-3">Expand all inspirations with AI before saving.</p>
        )}

        <button
          onClick={handleSaveStyle}
          disabled={!canSaveStyle || saving}
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
