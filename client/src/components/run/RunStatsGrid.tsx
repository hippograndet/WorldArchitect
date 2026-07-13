import type React from 'react';

interface RunStat {
  label: string;
  value: React.ReactNode;
  title?: string;
}

interface RunStatsGridProps {
  stats: RunStat[];
}

export default function RunStatsGrid({ stats }: RunStatsGridProps) {
  return (
    <div className="grid grid-cols-3 gap-3 border-b border-gray-100 p-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">{stat.label}</p>
          <p className="mt-1 truncate text-sm font-semibold text-gray-900" title={stat.title}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
