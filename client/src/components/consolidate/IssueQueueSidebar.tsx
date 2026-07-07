import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import LabelBadge from '../shared/LabelBadge.tsx';
import {
  type ConsolidationIssue,
  type ConsolidationBucket,
  type ConsolidationSeverity,
  type DocumentGroup,
  groupByDocument,
  filterIssues,
  worstSeverity,
} from '../../lib/consolidation.ts';

interface Props {
  issues: ConsolidationIssue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const BUCKETS: { value: ConsolidationBucket; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'closed', label: 'Closed' },
  { value: 'dismissed', label: 'Dismissed' },
];

const SEVERITIES: { value: ConsolidationSeverity; label: string }[] = [
  { value: 'blocking', label: 'Blocking' },
  { value: 'conflict', label: 'Conflict' },
  { value: 'warning', label: 'Warning' },
];

const SEVERITY_BAR: Record<ConsolidationSeverity, string> = {
  blocking: 'bg-red-400',
  conflict: 'bg-red-400',
  warning: 'bg-amber-400',
};

const GROUP_BADGE_COLOR: Record<ConsolidationSeverity, string> = {
  blocking: 'bg-red-100 text-red-700',
  conflict: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
};

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function groupKey(group: DocumentGroup): string {
  return group.articleId ?? '__world__';
}

function IssueRow({ issue, selected, onSelect }: { issue: ConsolidationIssue; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-start gap-2 text-left rounded-md px-2 py-1.5 transition-colors ${
        selected ? 'bg-purple-50 border border-purple-200' : 'border border-transparent hover:bg-gray-50'
      }`}
    >
      <span className={`w-1 self-stretch rounded-full shrink-0 ${SEVERITY_BAR[issue.severity]}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-gray-700 truncate">{issue.description}</span>
        <span className="block text-[10px] text-gray-400 mt-0.5">{relativeTime(issue.createdAt)}</span>
      </span>
    </button>
  );
}

function GroupSection({ group, selectedId, onSelect }: {
  group: DocumentGroup;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const worst = worstSeverity(group.counts);
  const containsSelected = selectedId !== null && group.issues.some((i) => i.id === selectedId);
  const defaultOpen = group.articleId === null || worst === 'blocking' || worst === 'conflict' || containsSelected;
  const [toggled, setToggled] = useState(false);
  const open = toggled ? !defaultOpen : defaultOpen;

  return (
    <div className="rounded-lg border border-gray-100">
      <button
        onClick={() => setToggled((t) => !t)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown size={12} className="text-gray-400 shrink-0" /> : <ChevronRight size={12} className="text-gray-400 shrink-0" />}
          <span className="text-xs font-medium text-gray-700 truncate">{group.title}</span>
        </span>
        {worst && <LabelBadge label={String(group.issues.length)} colorClass={GROUP_BADGE_COLOR[worst]} />}
      </button>
      {open && (
        <div className="px-1.5 pb-1.5 space-y-1">
          {group.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} selected={issue.id === selectedId} onSelect={() => onSelect(issue.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function IssueQueueSidebar({ issues, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState<ConsolidationBucket>('active');
  const [severity, setSeverity] = useState<ConsolidationSeverity | null>(null);

  const filtered = useMemo(
    () => filterIssues(issues, { bucket, severity: severity ?? undefined, query }),
    [issues, bucket, severity, query],
  );
  const groups = useMemo(() => groupByDocument(filtered), [filtered]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100">
        <h1 className="text-sm font-semibold text-gray-900">Issues</h1>
      </div>

      <div className="p-3 border-b border-gray-100 space-y-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search issues…"
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-purple-300"
        />
        <div className="flex flex-wrap gap-1">
          {BUCKETS.map((b) => (
            <button
              key={b.value}
              onClick={() => setBucket(b.value)}
              className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                bucket === b.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {SEVERITIES.map((s) => (
            <button
              key={s.value}
              onClick={() => setSeverity((cur) => (cur === s.value ? null : s.value))}
              className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                severity === s.value ? GROUP_BADGE_COLOR[s.value] + ' border-current' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {groups.length === 0 ? (
          <p className="text-xs text-gray-400">No issues match these filters.</p>
        ) : (
          groups.map((group) => (
            <GroupSection key={groupKey(group)} group={group} selectedId={selectedId} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  );
}
