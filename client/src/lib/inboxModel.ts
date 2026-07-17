import { GitPullRequestArrow, History, Inbox, Send } from 'lucide-react';
import type { InboxItem, InboxLane } from '../types/inbox.ts';

export const INBOX_LANES: Array<{ id: InboxLane; label: string }> = [
  { id: 'publish', label: 'Publish' },
  { id: 'flags', label: 'Flags' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'run_history', label: 'Run History' },
];

export const INBOX_LANE_LABEL: Record<InboxLane, string> = Object.fromEntries(
  INBOX_LANES.map((lane) => [lane.id, lane.label]),
) as Record<InboxLane, string>;

export const INBOX_SEVERITY_COLOR: Record<string, string> = {
  blocking: 'bg-red-100 text-red-700',
  conflict: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
};

export const INBOX_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-700',
  open: 'bg-blue-100 text-blue-700',
  in_review: 'bg-indigo-100 text-indigo-700',
  draft: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  stopped: 'bg-red-100 text-red-700',
};

export function payloadString(item: InboxItem, key: string): string | null {
  const value = item.payload[key];
  return typeof value === 'string' ? value : null;
}

export function payloadNumber(item: InboxItem, key: string): number {
  const value = item.payload[key];
  return typeof value === 'number' ? value : 0;
}

export function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function laneIcon(lane: InboxLane) {
  if (lane === 'publish') return Send;
  if (lane === 'suggestions') return GitPullRequestArrow;
  if (lane === 'run_history') return History;
  return Inbox;
}
