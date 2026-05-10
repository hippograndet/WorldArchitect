import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { WorldIssue, WorldIssueStatus, WorldIssueType } from '../types/world';

const TYPE_LABELS: Record<WorldIssueType, string> = {
  coherence: 'Coherence',
  gap:       'Gap',
  narrative: 'Narrative',
  thematic:  'Thematic',
};

const TYPE_COLORS: Record<WorldIssueType, string> = {
  coherence: 'bg-blue-100 text-blue-700',
  gap:       'bg-purple-100 text-purple-700',
  narrative: 'bg-orange-100 text-orange-700',
  thematic:  'bg-green-100 text-green-700',
};

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'Open',       value: 'open' },
  { label: 'In Review',  value: 'in_review' },
  { label: 'Resolved',   value: 'resolved' },
  { label: 'Dismissed',  value: 'dismissed' },
];

function SeverityBar({ severity }: { severity: 'warning' | 'conflict' }) {
  return (
    <div className={`w-1 self-stretch rounded-l ${severity === 'conflict' ? 'bg-red-400' : 'bg-amber-400'}`} />
  );
}

function ArticlePill({ articleId, wid }: { articleId: string; wid: string }) {
  const [title, setTitle] = useState<string>(articleId.slice(0, 8) + '…');
  useEffect(() => {
    api.articles.get(wid, articleId)
      .then(a => setTitle(a.article.title))
      .catch(() => {});
  }, [wid, articleId]);
  return (
    <Link
      to={`/worlds/${wid}/articles/${articleId}`}
      className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-[11px] hover:bg-gray-200 border border-gray-200 transition-colors"
    >
      {title}
    </Link>
  );
}

function IssueCard({ issue, wid, onStatusChange }: {
  issue: WorldIssue;
  wid: string;
  onStatusChange: (id: string, status: WorldIssueStatus) => void;
}) {
  const [updating, setUpdating] = useState(false);

  async function updateStatus(status: WorldIssueStatus) {
    setUpdating(true);
    try {
      await api.worldIssues.update(wid, issue.id, status);
      onStatusChange(issue.id, status);
    } finally {
      setUpdating(false);
    }
  }

  const isOpen = issue.status === 'open';
  const isInReview = issue.status === 'in_review';
  const isResolved = issue.status === 'resolved';
  const isDismissed = issue.status === 'dismissed';

  return (
    <div className={`flex rounded-lg border overflow-hidden ${isDismissed || isResolved ? 'opacity-60' : ''}`}>
      <SeverityBar severity={issue.severity} />
      <div className="flex-1 p-3 space-y-2">
        <div className="flex items-start gap-2 flex-wrap">
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${TYPE_COLORS[issue.type]}`}>
            {TYPE_LABELS[issue.type]}
          </span>
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${issue.severity === 'conflict' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
            {issue.severity}
          </span>
          {isInReview && (
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
              In Review
            </span>
          )}
          {isResolved && (
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-100 text-green-700">
              Resolved
            </span>
          )}
        </div>

        <p className="text-sm text-gray-800 leading-relaxed">{issue.description}</p>

        {issue.articleIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {issue.articleIds.map(aid => (
              <ArticlePill key={aid} articleId={aid} wid={wid} />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {isOpen && (
            <button
              onClick={() => updateStatus('in_review')}
              disabled={updating}
              className="text-[11px] px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50"
            >
              Mark In Review
            </button>
          )}
          {isInReview && (
            <button
              onClick={() => updateStatus('resolved')}
              disabled={updating}
              className="text-[11px] px-2 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50 transition-colors disabled:opacity-50"
            >
              Mark Resolved
            </button>
          )}
          {(isOpen || isInReview) && (
            <button
              onClick={() => updateStatus('dismissed')}
              disabled={updating}
              className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Dismiss
            </button>
          )}
          {(isDismissed || isResolved) && (
            <button
              onClick={() => updateStatus('open')}
              disabled={updating}
              className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Reopen
            </button>
          )}
          <span className="text-[10px] text-gray-400 ml-auto">
            {new Date(issue.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { wid } = useParams<{ wid: string }>();
  const [issues, setIssues] = useState<WorldIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAudit, setRunningAudit] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const loadIssues = useCallback(async () => {
    if (!wid) return;
    setLoading(true);
    try {
      const params: { status?: string; type?: string } = {};
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;
      const data = await api.worldIssues.list(wid, params);
      setIssues(data);
    } finally {
      setLoading(false);
    }
  }, [wid, statusFilter, typeFilter]);

  useEffect(() => { loadIssues(); }, [loadIssues]);

  function handleStatusChange(id: string, status: WorldIssueStatus) {
    setIssues(prev => prev.map(i => i.id === id ? { ...i, status, updatedAt: Date.now() } : i));
  }

  async function runAudit() {
    if (!wid) return;
    setRunningAudit(true);
    try {
      await api.agents.audit(wid, { focus: 'all' });
      await loadIssues();
    } catch (err) {
      console.error('Audit failed', err);
    } finally {
      setRunningAudit(false);
    }
  }

  const openCount = issues.filter(i => i.status === 'open').length;
  const inReviewCount = issues.filter(i => i.status === 'in_review').length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">World Issues Inbox</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            World-level insights from the Auditor — track and resolve them over time.
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={runningAudit}
          className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {runningAudit ? 'Running Audit…' : 'Re-run Audit'}
        </button>
      </div>

      {/* Summary row */}
      {(openCount > 0 || inReviewCount > 0) && (
        <div className="flex gap-3 text-xs">
          {openCount > 0 && (
            <span className="px-2 py-1 rounded bg-red-50 text-red-700 border border-red-100">
              {openCount} open
            </span>
          )}
          {inReviewCount > 0 && (
            <span className="px-2 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
              {inReviewCount} in review
            </span>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(statusFilter === f.value ? '' : f.value)}
            className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${statusFilter === f.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
          >
            {f.label}
          </button>
        ))}
        <div className="w-px bg-gray-200 mx-1" />
        {(Object.keys(TYPE_LABELS) as WorldIssueType[]).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
            className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${typeFilter === t ? TYPE_COLORS[t] + ' border-current' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Issues list */}
      {loading ? (
        <div className="text-xs text-gray-400 py-8 text-center">Loading…</div>
      ) : issues.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <div className="text-2xl">✓</div>
          <p className="text-sm text-gray-500">
            {statusFilter === 'open' ? 'No open issues — world looks coherent.' : 'No issues match these filters.'}
          </p>
          {statusFilter === 'open' && (
            <p className="text-xs text-gray-400">Run the Auditor to scan for coherence gaps and thematic issues.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {wid && issues.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              wid={wid}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
