import { useState, useEffect } from 'react';
import { ArrowLeft, Download, Settings } from 'lucide-react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import WorldBibleMeter from './WorldBibleMeter.tsx';
import { api } from '../../lib/api.ts';

const NAV_LINKS = [
  { label: 'Graph',    path: 'graph' },
  { label: 'Usage',    path: 'usage' },
  { label: 'Inbox',    path: 'inbox' },
  { label: 'Toolbox',  path: 'toolbox' },
  { label: 'Publish',  path: 'publish' },
  { label: 'Settings', path: 'settings' },
];

export default function TopBar() {
  const { wid } = useParams<{ wid: string }>();
  const location = useLocation();
  const { worlds, addToast } = useStore();
  const [inboxCount, setInboxCount] = useState(0);
  const [exporting, setExporting] = useState(false);

  const world = worlds.find((w) => w.id === wid);

  useEffect(() => {
    if (!wid) return;
    api.worldIssues.list(wid, { status: 'open' })
      .then(issues => setInboxCount(issues.length))
      .catch(() => {});
  }, [wid, location.pathname]);

  const handleExport = async () => {
    if (!wid || exporting) return;
    setExporting(true);

    try {
      const { blob, filename } = await api.export.download(wid);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      addToast({ message: 'Export downloaded.', type: 'success' });
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <header className="h-12 flex items-center gap-3 px-4 border-b border-gray-200 bg-surface shrink-0">
      <Link to="/" className="text-sm text-ink-muted hover:text-ink shrink-0 flex items-center gap-1">
        <ArrowLeft size={14} /> Worlds
      </Link>

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
          const badgeCount = path === 'inbox' ? inboxCount : 0;
          const showBadge = badgeCount > 0;
          return (
            <Link
              key={path}
              to={to}
              className={`relative px-2.5 py-1 text-xs rounded-md transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {label}
              {showBadge && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1">
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <WorldBibleMeter />
        <button
          onClick={handleExport}
          disabled={!wid || exporting}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={13} />
          {exporting ? 'Exporting…' : 'Export'}
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
          to="/settings"
          className="px-2 py-1 text-gray-400 hover:text-gray-700 text-sm"
          title="App settings"
          aria-label="App settings"
        >
          <Settings size={16} />
        </Link>
      </div>
    </header>
  );
}
