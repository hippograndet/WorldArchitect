import { RefreshCw } from 'lucide-react';
import type React from 'react';
import LabelBadge from '../shared/LabelBadge.tsx';
import type { Run } from '../../types/run.ts';
import { RUN_STATUS_LABELS, runStatusClass } from '../../lib/runModel.ts';

type Accent = 'blue' | 'purple';

interface RunListSidebarProps {
  title: string;
  emptyText: string;
  runs: Run[];
  selectedRunId: string | null;
  accent?: Accent;
  onRefresh?: () => void;
  onSelectRun(run: Run): void;
  getTitle(run: Run): string;
  getSubtitle?: (run: Run) => string | null;
  getTimestamp?: (run: Run) => string | null;
  getTopRight?: (run: Run) => string | null;
  renderStats?: (run: Run) => React.ReactNode;
  renderFooter?: (run: Run) => React.ReactNode;
}

const ACCENT_CLASSES: Record<Accent, string> = {
  blue: 'border-blue-200 bg-blue-50',
  purple: 'border-purple-300 bg-purple-50',
};

export default function RunListSidebar({
  title,
  emptyText,
  runs,
  selectedRunId,
  accent = 'blue',
  onRefresh,
  onSelectRun,
  getTitle,
  getSubtitle,
  getTimestamp,
  getTopRight,
  renderStats,
  renderFooter,
}: RunListSidebarProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-semibold text-gray-900">{title}</h1>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              title="Refresh runs"
              aria-label="Refresh runs"
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {runs.length === 0 ? (
          <p className="text-xs text-gray-400">{emptyText}</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const selected = selectedRunId === run.id;
              const failed = run.status === 'failed';
              const cancelled = run.status === 'stopped';
              return (
                <button
                  key={run.id}
                  onClick={() => onSelectRun(run)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? ACCENT_CLASSES[accent]
                      : failed
                        ? 'border-red-200 bg-red-50 hover:bg-red-100/50'
                        : cancelled
                          ? 'border-orange-200 bg-orange-50 hover:bg-orange-100/50'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <LabelBadge label={RUN_STATUS_LABELS[run.status]} colorClass={runStatusClass(run.status)} />
                    {getTopRight && <span className="text-[10px] text-gray-400">{getTopRight(run)}</span>}
                  </div>

                  <div className="mt-2">
                    <p className="truncate text-xs font-semibold text-gray-900">{getTitle(run)}</p>
                    {getSubtitle && (
                      <p className="mt-0.5 truncate text-xs text-gray-500" title={getSubtitle(run) ?? undefined}>
                        {getSubtitle(run)}
                      </p>
                    )}
                    {getTimestamp && <p className="mt-1 text-[10px] text-gray-400">{getTimestamp(run)}</p>}
                  </div>

                  {renderStats && <div className="mt-2">{renderStats(run)}</div>}
                  {renderFooter && renderFooter(run)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
