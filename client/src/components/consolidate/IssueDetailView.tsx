import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { api } from '../../lib/api.ts';
import LabelBadge from '../shared/LabelBadge.tsx';
import IssueFixPanel from '../shared/IssueFixPanel.tsx';
import { bucketForStatus, type ConsolidationIssue } from '../../lib/consolidation.ts';
import type { ArticleIssue } from '../../types/world.ts';

interface Props {
  wid: string;
  issue: ConsolidationIssue | null;
  onChanged: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  auditor: 'Auditor',
  rule: 'Rule',
  linter: 'Linter',
  warden: 'Coherence',
  publish_check: 'Publish',
};

const SEVERITY_COLOR: Record<string, string> = {
  blocking: 'bg-red-100 text-red-700',
  conflict: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
};

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_review: 'bg-indigo-100 text-indigo-700',
  resolved: 'bg-green-100 text-green-700',
  fixed: 'bg-green-100 text-green-700',
  dismissed: 'bg-gray-100 text-gray-500',
};

export default function IssueDetailView({ wid, issue, onChanged }: Props) {
  const { dispatchSolidify, startAudit } = useStore();
  const [busy, setBusy] = useState(false);

  if (!issue) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-6 text-center">
        <p className="text-sm text-gray-500">Select an issue from the queue to see details.</p>
      </div>
    );
  }

  const articleIssue = issue.scope === 'article' ? (issue.raw as ArticleIssue) : null;
  const excerpt = articleIssue?.excerpt ?? null;
  const suggestion = articleIssue?.suggestion ?? null;
  const bucket = bucketForStatus(issue.status);
  const singleArticleId = issue.articleIds.length === 1 ? issue.articleIds[0] : null;
  const singleArticleTitle = issue.articleTitles[0] ?? singleArticleId;

  async function updateStatus(status: string) {
    setBusy(true);
    try {
      if (issue!.scope === 'world') {
        await api.worldIssues.update(wid, issue!.id, status);
      } else {
        await api.issues.updateStatus(wid, issue!.articleIds[0], issue!.id, status as 'open' | 'in_review' | 'dismissed' | 'fixed');
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function dispatch(pipeline: 'cohere' | 'reorganize') {
    if (!singleArticleId) return;
    dispatchSolidify(wid, singleArticleId, singleArticleTitle ?? singleArticleId, pipeline);
  }

  function handleRerunAudit() {
    startAudit(wid).catch(console.error);
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <LabelBadge label={issue.severity} colorClass={SEVERITY_COLOR[issue.severity]} />
        <LabelBadge label={SOURCE_LABELS[issue.source] ?? issue.source} colorClass="bg-gray-100 text-gray-600" />
        <LabelBadge label={issue.status.replace('_', ' ')} colorClass={STATUS_COLOR[issue.status] ?? 'bg-gray-100 text-gray-500'} />
        <span className="text-xs text-gray-400 ml-auto">{issue.scope === 'world' ? 'World-wide' : 'Article'}</span>
      </div>

      {issue.articleIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {issue.articleIds.map((articleId, idx) => (
            <Link
              key={articleId}
              to={`/worlds/${wid}/articles/${articleId}`}
              className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs hover:bg-gray-200 border border-gray-200"
            >
              {issue.articleTitles[idx] ?? articleId}
            </Link>
          ))}
        </div>
      )}

      <p className="text-sm text-gray-800 leading-relaxed">{issue.description}</p>

      {excerpt && (
        <div className="font-mono text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5 border border-gray-100">
          &ldquo;{excerpt}&rdquo;
        </div>
      )}
      {suggestion && <p className="text-xs text-gray-500 italic">{suggestion}</p>}

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {bucket === 'active' && issue.status === 'open' && (
            <button onClick={() => updateStatus('in_review')} disabled={busy} className="text-xs px-2.5 py-1 rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
              Mark In Review
            </button>
          )}
          {bucket === 'active' && (
            <button
              onClick={() => updateStatus(issue.scope === 'world' ? 'resolved' : 'fixed')}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded-md border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-50"
            >
              Mark {issue.scope === 'world' ? 'Resolved' : 'Fixed'}
            </button>
          )}
          {bucket === 'active' && (
            <button onClick={() => updateStatus('dismissed')} disabled={busy} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
              Dismiss
            </button>
          )}
          {bucket !== 'active' && (
            <button onClick={() => updateStatus('open')} disabled={busy} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
              Reopen
            </button>
          )}
          {issue.scope === 'world' && issue.source === 'auditor' && (
            <button onClick={handleRerunAudit} className="text-xs px-2.5 py-1 rounded-md border border-purple-200 text-purple-700 hover:bg-purple-50">
              Re-run Audit
            </button>
          )}
          {singleArticleId && (
            <>
              <button onClick={() => dispatch('cohere')} className="text-xs px-2.5 py-1 rounded-md border border-blue-200 text-blue-700 hover:bg-blue-50">
                Re-run Coherence Check
              </button>
              <button onClick={() => dispatch('reorganize')} className="text-xs px-2.5 py-1 rounded-md border border-blue-200 text-blue-700 hover:bg-blue-50">
                Reorganize
              </button>
            </>
          )}
        </div>

        {issue.scope === 'article' && excerpt && singleArticleId && (
          <IssueFixPanel
            wid={wid}
            articleId={singleArticleId}
            issueId={issue.id}
            excerpt={excerpt}
            onApplied={onChanged}
          />
        )}
      </div>
    </div>
  );
}
