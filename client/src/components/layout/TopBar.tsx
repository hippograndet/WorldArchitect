import { useState, useEffect } from 'react';
import { ArrowLeft, Download, Menu, Settings } from 'lucide-react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import WorldBibleMeter from './WorldBibleMeter.tsx';
import { api } from '../../lib/api.ts';

const WORLD_SUB_LINKS = [
  { label: 'Overview',  path: '' },
  { label: 'Graph',     path: 'graph' },
  { label: 'Expand',    path: 'expand' },
  { label: 'Consolidate', path: 'consolidate' },
  { label: 'World Settings', path: 'settings' },
];

type MacroTab = 'world' | 'usage' | 'toolbox';

interface TopBarProps {
  documentsOpen: boolean;
  onToggleDocuments: () => void;
}

export default function TopBar({ documentsOpen, onToggleDocuments }: TopBarProps) {
  const { wid } = useParams<{ wid: string }>();
  const location = useLocation();
  const { worlds, addToast } = useStore();
  const [consolidateCount, setConsolidateCount] = useState(0);
  const [exporting, setExporting] = useState(false);

  const world = worlds.find((w) => w.id === wid);
  const base = `/worlds/${wid ?? ''}`;
  const pathAfterWorld = wid
    ? location.pathname.replace(`/worlds/${wid}`, '').replace(/^\//, '')
    : '';
  const macroTab: MacroTab = pathAfterWorld.startsWith('usage')
    ? 'usage'
    : pathAfterWorld.startsWith('toolbox')
      ? 'toolbox'
      : 'world';

  useEffect(() => {
    if (!wid) return;
    api.consolidation.count(wid)
      .then(({ open }) => setConsolidateCount(open))
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

  const macroClass = (active: boolean) => `px-3 py-1.5 text-sm rounded-md transition-colors ${
    active
      ? 'bg-blue-600 text-white shadow-sm'
      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
  }`;

  const subClass = (active: boolean) => `relative px-3 py-1.5 text-xs rounded-md transition-colors ${
    active
      ? 'bg-blue-50 text-blue-700 font-medium'
      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
  }`;

  return (
    <header className="border-b border-gray-200 bg-surface shrink-0">
      <div className="h-12 flex items-center gap-3 px-4">
        <Link to="/" className="text-sm text-ink-muted hover:text-ink shrink-0 flex items-center gap-1">
          <ArrowLeft size={14} /> Worlds
        </Link>

        <nav className="flex items-center gap-1 min-w-0">
          <Link to={base} className={macroClass(macroTab === 'world')}>
            <span className="font-medium">World:</span>{' '}
            <span className="inline-block max-w-[220px] truncate align-bottom">{world?.name ?? '...'}</span>
          </Link>
          <Link to={`${base}/usage`} className={macroClass(macroTab === 'usage')}>
            AI Usage
          </Link>
          <Link to={`${base}/toolbox`} className={macroClass(macroTab === 'toolbox')}>
            Toolbox
          </Link>
        </nav>

        <div className="flex items-center gap-2 ml-auto">
          {macroTab === 'world' && (
            <>
              <WorldBibleMeter />
              <button
                onClick={handleExport}
                disabled={!wid || exporting}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={13} />
                {exporting ? 'Exporting...' : 'Export'}
              </button>
            </>
          )}
          <Link
            to="/settings"
            className="p-2 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            title="App settings"
            aria-label="App settings"
          >
            <Settings size={16} />
          </Link>
        </div>
      </div>

      <div className="h-10 flex items-center gap-2 px-4 border-t border-gray-100 bg-gray-50/70">
        {macroTab === 'world' && (
          <>
            <button
              onClick={onToggleDocuments}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                documentsOpen
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
              aria-pressed={documentsOpen}
            >
              <Menu size={14} />
              Documents
            </button>
            <div className="h-5 w-px bg-gray-200" />
            <nav className="flex items-center gap-1 overflow-x-auto">
              {WORLD_SUB_LINKS.map(({ label, path }) => {
                const to = path ? `${base}/${path}` : base;
                const active = path === ''
                  ? location.pathname === base
                  : location.pathname === to;
                const badgeCount = path === 'consolidate' ? consolidateCount : 0;
                const showBadge = badgeCount > 0;

                return (
                  <Link key={path || 'overview'} to={to} className={subClass(active)}>
                    {label}
                    {showBadge && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1">
                        {badgeCount > 9 ? '9+' : badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </>
        )}

        {macroTab === 'usage' && (
          <nav className="flex items-center gap-1">
            <Link to={`${base}/usage`} className={subClass(true)}>Calls & Limits</Link>
          </nav>
        )}

        {macroTab === 'toolbox' && (
          <nav className="flex items-center gap-1">
            <Link to={`${base}/toolbox`} className={subClass(true)}>World-Agnostic Tools</Link>
          </nav>
        )}
      </div>
    </header>
  );
}
