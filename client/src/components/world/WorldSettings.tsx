import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';

export default function WorldSettings() {
  const { wid } = useParams<{ wid: string }>();
  const navigate = useNavigate();
  const { worlds, deleteWorld, addToast } = useStore();

  const world = worlds.find((w) => w.id === wid);

  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting]       = useState(false);

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

  return (
    <div className="max-w-xl mx-auto py-10 px-6">
      <Link to={`/worlds/${wid ?? ''}`} className="text-sm text-gray-400 hover:text-gray-700">← Back</Link>

      <h1 className="text-xl font-bold text-gray-900 mt-4 mb-1">Settings</h1>
      <p className="text-sm text-gray-500 mb-8">{world.name}</p>

      {/* World info (read-only for now) */}
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
