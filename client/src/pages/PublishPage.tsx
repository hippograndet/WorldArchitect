import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { ArticleIssue } from '../types/world';

type StagedArticle = {
  id: string;
  title: string;
  status: string;
  templateType: string;
  depth: number;
  blockingIssues: number;
  warningIssues: number;
  health: string;
  updatedAt: number;
};

type CheckResult = {
  summary: { blocking: number; warnings: number; clean: number };
  issues: ArticleIssue[];
};

function HealthDot({ health }: { health: string }) {
  const color = health === 'blocking' ? 'bg-red-500' : health === 'warnings' ? 'bg-amber-400' : 'bg-green-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function IssueRow({ issue }: { issue: ArticleIssue & { articleTitle?: string } }) {
  return (
    <div className={`rounded border p-3 text-xs space-y-1 ${issue.severity === 'blocking' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-center gap-2">
        <span className={`font-semibold uppercase text-[10px] tracking-wide px-1.5 py-0.5 rounded ${issue.severity === 'blocking' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
          {issue.severity}
        </span>
        <span className="text-gray-500">{issue.code}</span>
        {(issue as { articleTitle?: string }).articleTitle && (
          <span className="text-gray-700 font-medium">— {(issue as { articleTitle?: string }).articleTitle}</span>
        )}
      </div>
      {issue.excerpt && (
        <div className="font-mono text-gray-600 bg-white rounded px-2 py-1 border border-gray-100">
          &ldquo;{issue.excerpt}&rdquo;
        </div>
      )}
      <div className="text-gray-700">{issue.explanation}</div>
      {issue.suggestion && <div className="text-gray-500 italic">{issue.suggestion}</div>}
    </div>
  );
}

export default function PublishPage() {
  const { wid } = useParams<{ wid: string }>();

  const [staged, setStaged] = useState<StagedArticle[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [forceConfirm, setForceConfirm] = useState('');
  const [publishedCount, setPublishedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStaged = useCallback(async () => {
    if (!wid) return;
    try {
      const articles = await api.publish.staged(wid);
      setStaged(articles);
    } catch {
      setError('Failed to load articles');
    }
  }, [wid]);

  useEffect(() => { void loadStaged(); }, [loadStaged]);

  const toggleAll = () => {
    if (selected.size === staged.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(staged.map(a => a.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectClean = () => {
    setSelected(new Set(staged.filter(a => a.health === 'clean').map(a => a.id)));
  };

  const runCheck = async () => {
    if (!wid || selected.size === 0) return;
    setLoading(true);
    setCheckResult(null);
    setError(null);
    try {
      const result = await api.publish.check(wid, [...selected]);
      setCheckResult(result);
    } catch {
      setError('Check failed');
    } finally {
      setLoading(false);
    }
  };

  const runPublish = async (force = false) => {
    if (!wid || selected.size === 0) return;
    setPublishing(true);
    setError(null);
    try {
      const result = await api.publish.commit(wid, [...selected], force);
      setPublishedCount(result.published.length);
      setSelected(new Set());
      setCheckResult(null);
      setForceConfirm('');
      await loadStaged();
    } catch (err: unknown) {
      const e = err as { message?: string; status?: number };
      if (e.status === 422) {
        setError('Blocking issues must be resolved before publishing. Use Force Publish to override.');
      } else {
        setError('Publish failed');
      }
    } finally {
      setPublishing(false);
    }
  };

  const hasBlocking = (checkResult?.summary.blocking ?? 0) > 0;
  const canPublish = selected.size > 0 && !hasBlocking;
  const canForcePublish = selected.size > 0 && hasBlocking && forceConfirm === 'PUBLISH ANYWAY';

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: article list */}
      <div className="w-80 border-r border-gray-200 flex flex-col bg-white">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Publish</h2>
          <p className="text-xs text-gray-500 mt-0.5">Select articles to publish together</p>
        </div>

        <div className="p-3 border-b border-gray-100 flex items-center gap-2">
          <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
            {selected.size === staged.length ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-gray-300">·</span>
          <button onClick={selectClean} className="text-xs text-green-600 hover:underline">
            Select clean
          </button>
          <span className="ml-auto text-xs text-gray-400">{selected.size} selected</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {staged.length === 0 ? (
            <p className="p-4 text-xs text-gray-400">No draft articles to publish.</p>
          ) : (
            staged.map(article => (
              <label key={article.id} className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 border-b border-gray-50">
                <input
                  type="checkbox"
                  checked={selected.has(article.id)}
                  onChange={() => toggleOne(article.id)}
                  className="mt-0.5 accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <HealthDot health={article.health} />
                    <span className="text-xs font-medium text-gray-800 truncate">{article.title}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {article.templateType} · depth {article.depth}
                    {article.blockingIssues > 0 && (
                      <span className="ml-1 text-red-500">⛔ {article.blockingIssues}</span>
                    )}
                    {article.warningIssues > 0 && (
                      <span className="ml-1 text-amber-500">⚠ {article.warningIssues}</span>
                    )}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Right: check results + actions */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        <div className="p-4 border-b border-gray-200 bg-white flex items-center gap-3">
          <button
            onClick={runCheck}
            disabled={selected.size === 0 || loading}
            className="px-3 py-1.5 rounded text-xs font-medium bg-gray-900 text-white disabled:opacity-40"
          >
            {loading ? 'Checking…' : 'Run publish check'}
          </button>

          {checkResult && (
            <>
              <button
                onClick={() => void runPublish(false)}
                disabled={!canPublish || publishing}
                className="px-3 py-1.5 rounded text-xs font-medium bg-green-600 text-white disabled:opacity-40"
              >
                {publishing ? 'Publishing…' : `Publish ${selected.size} article${selected.size !== 1 ? 's' : ''}`}
              </button>
            </>
          )}

          {error && <span className="text-xs text-red-600">{error}</span>}
          {publishedCount !== null && (
            <span className="text-xs text-green-600 font-medium">
              Published {publishedCount} article{publishedCount !== 1 ? 's' : ''} successfully.
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!checkResult && !loading && (
            <div className="text-sm text-gray-400 text-center pt-16">
              Select articles and run a publish check to see results.
            </div>
          )}

          {loading && (
            <div className="text-sm text-gray-400 text-center pt-16">Running checks…</div>
          )}

          {checkResult && (
            <>
              {/* Summary */}
              <div className="flex gap-3">
                <div className="flex-1 rounded border bg-white p-3 text-center">
                  <div className="text-2xl font-bold text-red-600">{checkResult.summary.blocking}</div>
                  <div className="text-xs text-gray-500">Blocking</div>
                </div>
                <div className="flex-1 rounded border bg-white p-3 text-center">
                  <div className="text-2xl font-bold text-amber-500">{checkResult.summary.warnings}</div>
                  <div className="text-xs text-gray-500">Warnings</div>
                </div>
                <div className="flex-1 rounded border bg-white p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{checkResult.summary.clean}</div>
                  <div className="text-xs text-gray-500">Clean</div>
                </div>
              </div>

              {/* Issues list */}
              {checkResult.issues.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Issues</h3>
                  {checkResult.issues.map(issue => (
                    <IssueRow key={issue.id} issue={issue as ArticleIssue & { articleTitle?: string }} />
                  ))}
                </div>
              )}

              {checkResult.issues.length === 0 && (
                <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-700 text-center">
                  All selected articles passed the publish check.
                </div>
              )}

              {/* Force publish section */}
              {hasBlocking && (
                <div className="rounded border border-red-200 bg-red-50 p-4 space-y-3">
                  <p className="text-xs text-red-700 font-medium">
                    {checkResult.summary.blocking} blocking issue{checkResult.summary.blocking !== 1 ? 's' : ''} must be resolved before publishing.
                  </p>
                  <p className="text-xs text-red-600">
                    To force publish anyway, type <strong>PUBLISH ANYWAY</strong> below:
                  </p>
                  <input
                    type="text"
                    value={forceConfirm}
                    onChange={e => setForceConfirm(e.target.value)}
                    placeholder="PUBLISH ANYWAY"
                    className="w-full border border-red-300 rounded px-2 py-1 text-xs font-mono"
                  />
                  <button
                    onClick={() => void runPublish(true)}
                    disabled={!canForcePublish || publishing}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-red-600 text-white disabled:opacity-40"
                  >
                    Force Publish
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
