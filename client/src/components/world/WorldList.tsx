import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function WorldList() {
  const navigate = useNavigate();
  const { worlds, loadWorlds } = useStore();

  useEffect(() => {
    loadWorlds().catch(console.error);
  }, [loadWorlds]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-16 px-4">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">WorldArchitect</h1>
          <button
            onClick={() => navigate('/new')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + New World
          </button>
        </div>

        {worlds.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg mb-2">No worlds yet.</p>
            <p className="text-sm">Create your first world to get started.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {worlds.map((w) => (
              <div key={w.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
                <Link to={`/worlds/${w.id}`} className="block">
                  <h2 className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">{w.name}</h2>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{w.description}</p>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span>{w.tone}</span>
                      {w.tags.length > 0 && (
                        <>
                          <span>·</span>
                          <span>{w.tags.join(', ')}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>Updated {timeAgo(w.updatedAt)}</span>
                    </div>
                    {/* Settings link — the safe way to access delete */}
                    <Link
                      to={`/worlds/${w.id}/settings`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-gray-300 hover:text-gray-500 flex items-center gap-1"
                      title="World settings"
                    >
                      ⚙
                    </Link>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
