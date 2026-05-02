import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../stores/index.ts';
import { api } from '../lib/api.ts';

interface Snapshot {
  id: string;
  name: string;
  created_at: number;
}

export default function SnapshotsPage() {
  const { wid } = useParams<{ wid: string }>();
  const navigate = useNavigate();
  const { loadTree, addToast, showConfirm } = useStore();

  const [snapshots, setSnapshots]   = useState<Snapshot[]>([]);
  const [loading, setLoading]       = useState(false);
  const [nameInput, setNameInput]   = useState('');
  const [creating, setCreating]     = useState(false);

  const load = () => {
    if (!wid) return;
    setLoading(true);
    api.snapshots.list(wid)
      .then(setSnapshots)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [wid]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wid || !nameInput.trim() || creating) return;
    setCreating(true);
    try {
      await api.snapshots.create(wid, nameInput.trim());
      setNameInput('');
      load();
      addToast({ message: 'Snapshot saved.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = (snap: Snapshot) => {
    if (!wid) return;
    showConfirm({
      title: `Restore "${snap.name}"?`,
      message: 'Your current world state will be auto-saved as a snapshot first, then rolled back.',
      confirmLabel: 'Restore',
      onConfirm: async () => {
        try {
          await api.snapshots.restore(wid, snap.id);
          await loadTree(wid);
          addToast({ message: `Restored "${snap.name}".`, type: 'success' });
          navigate(`/worlds/${wid}`);
        } catch (err) {
          addToast({ message: (err as Error).message, type: 'error' });
        }
      },
    });
  };

  const handleDelete = (snap: Snapshot) => {
    if (!wid) return;
    showConfirm({
      title: `Delete "${snap.name}"?`,
      message: 'This snapshot will be permanently removed.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await api.snapshots.delete(wid, snap.id);
          load();
          addToast({ message: 'Snapshot deleted.', type: 'success' });
        } catch (err) {
          addToast({ message: (err as Error).message, type: 'error' });
        }
      },
    });
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Snapshots</h1>
      <p className="text-xs text-gray-400 mb-8">
        Named checkpoints of the entire world. Restoring rolls back all articles to that state.
      </p>

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-2 mb-8">
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder='Snapshot name, e.g. "Pre-war draft"'
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button
          type="submit"
          disabled={!nameInput.trim() || creating}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
        >
          {creating ? 'Saving…' : 'Save Snapshot'}
        </button>
      </form>

      {/* List */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : snapshots.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No snapshots yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {[...snapshots].reverse().map((snap) => (
            <div
              key={snap.id}
              className="flex items-center justify-between gap-4 p-4 bg-white border border-gray-200 rounded-xl"
            >
              <div>
                <p className="text-sm font-semibold text-gray-800">{snap.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(snap.created_at * 1000).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleRestore(snap)}
                  className="px-3 py-1.5 text-xs font-medium border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50"
                >
                  Restore
                </button>
                <button
                  onClick={() => handleDelete(snap)}
                  className="px-3 py-1.5 text-xs text-red-400 border border-red-200 rounded-lg hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
