import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { ArticleIssue, WorldIssue } from '../../types/world';

interface Props {
  wid: string;
  aid: string;
}

const SOURCE_LABELS: Record<string, string> = {
  rule: 'Rule',
  linter: 'Linter',
  warden: 'Coherence',
  publish_check: 'Publish',
};

function ArticleIssueRow({ issue, onUpdate }: {
  issue: ArticleIssue;
  onUpdate: (id: string, status: ArticleIssue['status']) => void;
}) {
  const [acting, setActing] = useState(false);

  async function act(status: ArticleIssue['status']) {
    setActing(true);
    try {
      await api.issues.updateStatus(issue.worldId, issue.articleId, issue.id, status);
      onUpdate(issue.id, status);
    } finally {
      setActing(false);
    }
  }

  const isOpen = issue.status === 'open';
  const isInReview = issue.status === 'in_review';

  return (
    <div className={`text-xs border rounded p-2.5 space-y-1 ${issue.severity === 'blocking' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'} ${issue.status !== 'open' && issue.status !== 'in_review' ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded ${issue.severity === 'blocking' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
          {issue.severity}
        </span>
        <span className="text-gray-500 text-[10px]">{SOURCE_LABELS[issue.source] ?? issue.source}</span>
        {isInReview && (
          <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-indigo-100 text-indigo-700">In Review</span>
        )}
        {issue.status === 'dismissed' && (
          <span className="text-[10px] text-gray-400">Dismissed</span>
        )}
        {issue.status === 'fixed' && (
          <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-green-100 text-green-700">Fixed</span>
        )}
      </div>
      {issue.excerpt && (
        <div className="font-mono text-gray-600 bg-white rounded px-1.5 py-0.5 border border-gray-100 text-[11px]">
          &ldquo;{issue.excerpt}&rdquo;
        </div>
      )}
      <p className="text-gray-700 leading-snug">{issue.explanation}</p>
      {issue.suggestion && <p className="text-gray-500 italic">{issue.suggestion}</p>}
      {(isOpen || isInReview) && (
        <div className="flex gap-1.5 pt-0.5">
          {isOpen && (
            <button
              onClick={() => act('in_review')}
              disabled={acting}
              className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              In Review
            </button>
          )}
          {isInReview && (
            <button
              onClick={() => act('open')}
              disabled={acting}
              className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              Reopen
            </button>
          )}
          <button
            onClick={() => act('dismissed')}
            disabled={acting}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export default function ArticleIssuesPanel({ wid, aid }: Props) {
  const [issues, setIssues] = useState<ArticleIssue[]>([]);
  const [worldNotes, setWorldNotes] = useState<WorldIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [linting, setLinting] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [articleIssues, notes] = await Promise.all([
        api.issues.list(wid, aid),
        api.worldIssues.forArticle(wid, aid),
      ]);
      setIssues(articleIssues);
      setWorldNotes(notes);
    } finally {
      setLoading(false);
    }
  }, [wid, aid]);

  useEffect(() => { load(); }, [load]);

  function handleIssueUpdate(id: string, status: ArticleIssue['status']) {
    setIssues(prev => prev.map(i => i.id === id ? { ...i, status } : i));
  }

  async function runLint() {
    setLinting(true);
    try {
      const newIssues = await api.issues.lint(wid, aid);
      setIssues(prev => {
        const kept = prev.filter(i => i.source !== 'linter');
        return [...kept, ...newIssues];
      });
    } finally {
      setLinting(false);
    }
  }

  const openIssues = issues.filter(i => i.status === 'open' || i.status === 'in_review');
  const blockingCount = openIssues.filter(i => i.severity === 'blocking').length;
  const warningCount = openIssues.filter(i => i.severity === 'warning').length;
  const hasAnything = openIssues.length > 0 || worldNotes.length > 0;

  if (loading) return null;
  if (!hasAnything) {
    return (
      <div className="mt-8 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">No open issues</span>
          <button onClick={runLint} disabled={linting} className="text-[11px] text-gray-400 hover:text-gray-600 disabled:opacity-50">
            {linting ? 'Running…' : 'Run Linter'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2 text-xs font-medium text-gray-600 hover:text-gray-900"
        >
          <span>{expanded ? '▾' : '▸'}</span>
          <span>Issues</span>
          {blockingCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">{blockingCount} blocking</span>
          )}
          {warningCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px]">{warningCount} warnings</span>
          )}
          {worldNotes.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px]">{worldNotes.length} world note{worldNotes.length !== 1 ? 's' : ''}</span>
          )}
        </button>
        <button onClick={runLint} disabled={linting} className="text-[11px] text-gray-400 hover:text-gray-600 disabled:opacity-50">
          {linting ? 'Running…' : 'Run Linter'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-2">
          {openIssues.map(issue => (
            <ArticleIssueRow key={issue.id} issue={issue} onUpdate={handleIssueUpdate} />
          ))}

          {worldNotes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-2">World Notes</p>
              {worldNotes.map(note => (
                <div key={note.id} className="flex items-start gap-2 text-xs text-gray-600 mb-1.5">
                  <span className={`shrink-0 text-[10px] font-semibold px-1 py-0.5 rounded ${note.type === 'coherence' ? 'bg-blue-50 text-blue-600' : note.type === 'gap' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>
                    {note.type}
                  </span>
                  <span className="leading-snug">{note.description}</span>
                  <Link to={`/worlds/${wid}/inbox`} className="shrink-0 text-[10px] text-gray-400 hover:text-gray-600 underline">
                    Inbox
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
