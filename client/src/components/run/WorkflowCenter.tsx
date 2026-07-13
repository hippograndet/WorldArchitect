import { PanelRightOpen } from 'lucide-react';
import type React from 'react';

interface WorkflowCenterProps {
  accentClass: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  settingsOpen: boolean;
  loading?: boolean;
  emptyTitle: string;
  emptyText: string;
  onShowSettings(): void;
  children: React.ReactNode;
}

export default function WorkflowCenter({
  accentClass,
  eyebrow,
  title,
  subtitle,
  settingsOpen,
  loading = false,
  emptyTitle,
  emptyText,
  onShowSettings,
  children,
}: WorkflowCenterProps) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${accentClass}`}>{eyebrow}</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">{title}</h2>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        {!settingsOpen && (
          <button
            onClick={onShowSettings}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <PanelRightOpen size={14} />
            Show Settings
          </button>
        )}
      </div>

      <section className="min-h-[520px] overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading selected run...</div>
        ) : !children ? (
          <div className="p-6">
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6">
              <p className="text-sm font-semibold text-gray-900">{emptyTitle}</p>
              <p className="mt-1 text-sm text-gray-500">{emptyText}</p>
            </div>
          </div>
        ) : children}
      </section>
    </div>
  );
}
