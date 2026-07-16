import type { Run, RunWithEvents } from '../types/run.ts';

export const RUN_STATUS_LABELS: Record<Run['status'], string> = {
  pending: 'Queued',
  running: 'In progress',
  paused: 'Paused',
  needs_input: 'Needs input',
  completed: 'Finished successfully',
  stopped: 'Cancelled',
  failed: 'Finished unsuccessfully',
};

export function runStatusClass(status: Run['status']): string {
  if (status === 'completed') return 'bg-green-100 text-green-700';
  if (status === 'failed') return 'bg-red-100 text-red-700';
  if (status === 'stopped') return 'bg-orange-100 text-orange-700';
  if (status === 'paused' || status === 'needs_input') return 'bg-amber-100 text-amber-700';
  if (status === 'running' || status === 'pending') return 'bg-blue-100 text-blue-700';
  return 'bg-gray-100 text-gray-600';
}

export function shortRunId(id: string): string {
  return id.slice(0, 8);
}

export function defaultRunTitle(run: Run | RunWithEvents, prefix = 'Run'): string {
  return `${prefix} ${shortRunId(run.id)}`;
}

export function formatRunDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function isWorkflowRunActive(run: Pick<Run, 'status'>): boolean {
  return run.status === 'running' || run.status === 'pending' || run.status === 'needs_input' || run.status === 'paused';
}
