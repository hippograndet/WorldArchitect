import { Link, useParams, useLocation } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import WorldBibleMeter from './WorldBibleMeter.tsx';
import { api } from '../../lib/api.ts';

const NAV_LINKS = [
  { label: 'Timeline', path: 'timeline' },
  { label: 'Usage',    path: 'usage' },
];

export default function TopBar() {
  const { wid } = useParams<{ wid: string }>();
  const location = useLocation();
  const { worlds, addToast } = useStore();

  const world = worlds.find((w) => w.id === wid);

  const handleExport = () => {
    if (!wid) return;
    window.location.href = api.export.downloadUrl(wid);
    addToast({ message: 'Export started…', type: 'info' });
  };

  return (
    <header className="h-12 flex items-center gap-3 px-4 border-b border-gray-200 bg-surface shrink-0">
      <Link to="/" className="text-sm text-ink-muted hover:text-ink shrink-0">← Worlds</Link>

      <Link
        to={`/worlds/${wid ?? ''}`}
        className="font-semibold text-ink truncate hover:text-blue-600 transition-colors"
        style={{ maxWidth: '180px' }}
      >
        {world?.name ?? '…'}
      </Link>

      <div className="flex items-center gap-0.5 ml-1">
        {NAV_LINKS.map(({ label, path }) => {
          const to = `/worlds/${wid ?? ''}/${path}`;
          const active = location.pathname === to;
          return (
            <Link
              key={path}
              to={to}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <WorldBibleMeter />
        <button
          onClick={handleExport}
          className="px-3 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
        >
          Export
        </button>
        <Link
          to={`/worlds/${wid ?? ''}/snapshots`}
          className={`px-3 py-1 text-xs rounded-md border transition-colors ${
            location.pathname === `/worlds/${wid}/snapshots`
              ? 'border-blue-300 bg-blue-50 text-blue-600'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Snapshots
        </Link>
        <Link
          to={`/worlds/${wid ?? ''}/settings`}
          className="px-2 py-1 text-gray-400 hover:text-gray-700 text-sm"
          title="World settings"
        >
          ⚙
        </Link>
      </div>
    </header>
  );
}
