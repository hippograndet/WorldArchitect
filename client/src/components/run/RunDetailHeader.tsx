import type React from 'react';
import LabelBadge from '../shared/LabelBadge.tsx';
import type { Run } from '../../types/run.ts';
import { RUN_STATUS_LABELS, runStatusClass } from '../../lib/runModel.ts';

interface RunDetailHeaderProps {
  run: Run;
  title: string;
  createdLabel: string;
  actions?: React.ReactNode;
}

export default function RunDetailHeader({ run, title, createdLabel, actions }: RunDetailHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <LabelBadge label={RUN_STATUS_LABELS[run.status]} colorClass={runStatusClass(run.status)} />
        </div>
        <p className="mt-1 text-xs text-gray-500">ID: {run.id} · created {createdLabel}</p>
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
