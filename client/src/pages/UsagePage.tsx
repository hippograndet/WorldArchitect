import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStore } from '../stores/index.ts';
import { api } from '../lib/api.ts';
import type { AgentCostProfile, ProviderSettingsResponse } from '../lib/api.ts';

interface CallLogEntry {
  id: string;
  agentType: string;
  articleId: string | null;
  tokensIn: number;
  tokensOut: number;
  status: 'success' | 'error' | 'cap_exceeded';
  errorMessage: string | null;
  iterations: number | null;
  pipelineRunId: string | null;
  pipelineType: string | null;
  createdAt: number;
}

interface AgentSummaryRow {
  agentType: string;
  calls: number;
  avgTokensIn: number | null;
  avgTokensOut: number | null;
  avgIterations: number | null;
}

interface PipelineRunRow {
  pipelineRunId: string;
  pipelineType: string | null;
  calls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  startedAt: number;
  endedAt: number;
  agents: string[];
}

export default function UsagePage() {
  const { wid } = useParams<{ wid: string }>();
  const { addToast } = useStore();

  const [entries, setEntries]     = useState<CallLogEntry[]>([]);
  const [total, setTotal]         = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [dailyCap, setDailyCap]   = useState<number | null>(null);
  const [threshold, setThreshold] = useState(80000);
  const [capInput, setCapInput]   = useState('');
  const [thresholdInput, setThresholdInput] = useState('');
  const [saving, setSaving]       = useState(false);
  const [providerSettings, setProviderSettings] = useState<ProviderSettingsResponse | null>(null);
  const [agentProfiles, setAgentProfiles] = useState<Record<string, AgentCostProfile>>({});

  const [agentSummary, setAgentSummary] = useState<AgentSummaryRow[]>([]);
  const [runs, setRuns]                 = useState<PipelineRunRow[]>([]);
  const [runsTotal, setRunsTotal]       = useState(0);
  const [runsPage, setRunsPage]         = useState(1);

  useEffect(() => {
    if (!wid) return;
    setLoading(true);
    Promise.all([
      api.callLog.list(wid, page),
      api.settings.worldGet(wid),
      api.settings.get(),
    ])
      .then(([log, settings, provider]) => {
        setEntries(log.calls as CallLogEntry[]);
        setTotal(log.pagination.total);
        setTodayCount(log.todayCount);
        setDailyCap(settings.dailyCap);
        setThreshold(settings.bibleThreshold);
        setCapInput(settings.dailyCap?.toString() ?? '');
        setThresholdInput(settings.bibleThreshold.toString());
        setProviderSettings(provider);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [wid, page]);

  useEffect(() => {
    if (!wid) return;
    api.callLog.summary(wid).then((res) => setAgentSummary(res.agents)).catch(console.error);
    api.agents.costProfile(wid)
      .then((res) => setAgentProfiles(Object.fromEntries(res.agents.map((profile) => [profile.agentType, profile]))))
      .catch(console.error);
  }, [wid]);

  useEffect(() => {
    if (!wid) return;
    api.callLog.runs(wid, runsPage)
      .then((res) => { setRuns(res.runs); setRunsTotal(res.pagination.total); })
      .catch(console.error);
  }, [wid, runsPage]);

  const handleSaveSettings = async () => {
    if (!wid || saving) return;
    setSaving(true);
    try {
      const cap = capInput.trim() ? parseInt(capInput, 10) : null;
      const thr = parseInt(thresholdInput, 10);
      if (thr && !isNaN(thr)) {
        await api.settings.worldUpdate(wid, {
          dailyCap: cap && !isNaN(cap) ? cap : null,
          bibleThreshold: thr,
        });
        setDailyCap(cap && !isNaN(cap) ? cap : null);
        setThreshold(thr);
        addToast({ message: 'Settings saved.', type: 'success' });
      }
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.ceil(total / 20);

  const statusColor = (s: string) =>
    s === 'success' ? 'text-green-600' :
    s === 'error'   ? 'text-red-600' :
                      'text-amber-600';

  const activeProvider = providerSettings?.provider ?? 'none';
  const activeModel = providerSettings && activeProvider !== 'none'
    ? providerSettings[activeProvider].model
    : 'Not configured';

  return (
    <div className="max-w-4xl mx-auto py-8 px-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">AI Usage</h1>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-xs text-gray-400 mb-1">Provider</p>
          <p className="text-2xl font-bold text-gray-900 capitalize">{activeProvider}</p>
          <p className="text-xs text-gray-400 mt-0.5 truncate" title={activeModel}>{activeModel}</p>
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-xs text-gray-400 mb-1">Today's calls</p>
          <p className="text-2xl font-bold text-gray-900">{todayCount}</p>
          {dailyCap !== null && (
            <p className="text-xs text-gray-400 mt-0.5">of {dailyCap} cap</p>
          )}
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-xs text-gray-400 mb-1">Total logged calls</p>
          <p className="text-2xl font-bold text-gray-900">{total}</p>
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-xs text-gray-400 mb-1">Bible threshold</p>
          <p className="text-2xl font-bold text-gray-900">{(threshold / 1000).toFixed(0)}k</p>
          <p className="text-xs text-gray-400 mt-0.5">tokens</p>
        </div>
      </div>

      {/* Settings */}
      <section className="mb-8 p-5 bg-white border border-gray-200 rounded-xl">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Cost settings</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Daily call cap (blank = unlimited)</label>
            <input
              type="number"
              min={0}
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              placeholder="e.g. 20"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bible token threshold</label>
            <input
              type="number"
              min={1000}
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              placeholder="e.g. 80000"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="mt-3 px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </section>

      {/* By-agent rollup, with theoretical expected range alongside the measured average */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">By agent</h2>
        {agentSummary.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No AI calls recorded yet.</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Agent</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Calls</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Avg in</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Avg out</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Avg iters</th>
                  <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Expected</th>
                </tr>
              </thead>
              <tbody>
                {agentSummary.map((a) => {
                  const profile = agentProfiles[a.agentType];
                  const callLabel = profile
                    ? profile.callRange.min === profile.callRange.max
                      ? `${profile.callRange.min} turns`
                      : `${profile.callRange.min}-${profile.callRange.max} turns`
                    : '—';
                  return (
                    <tr key={a.agentType} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-700">{a.agentType}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{a.calls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{a.avgTokensIn?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{a.avgTokensOut?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{a.avgIterations ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400" title={profile?.note}>
                        {callLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* By-pipeline-run grouping — one row per user-initiated pipeline invocation
          (e.g. one 'expand' call's Researcher+Scribe+ContinuityEditor), not per raw agent call */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">By pipeline run</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No pipeline runs recorded yet.</p>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Started</th>
                    <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Pipeline</th>
                    <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Agents</th>
                    <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Calls</th>
                    <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Total tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.pipelineRunId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-400 font-mono whitespace-nowrap">
                        {new Date(r.startedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{r.pipelineType ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500">{r.agents.join(' → ')}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{r.calls}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">
                        {(r.totalTokensIn + r.totalTokensOut).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {runsTotal > runs.length && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  onClick={() => setRunsPage((p) => Math.max(1, p - 1))}
                  disabled={runsPage === 1}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40"
                >
                  ← Prev
                </button>
                <span className="text-xs text-gray-500">page {runsPage}</span>
                <button
                  onClick={() => setRunsPage((p) => p + 1)}
                  disabled={runsPage * 20 >= runsTotal}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Call log table */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Call log</h2>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No AI calls recorded yet.</p>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Time</th>
                    <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Agent</th>
                    <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Article</th>
                    <th className="px-4 py-2.5 text-right text-gray-500 font-medium">In</th>
                    <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Out</th>
                    <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Iters</th>
                    <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-400 font-mono whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{e.agentType}</td>
                      <td className="px-4 py-2.5">
                        {e.articleId ? (
                          <Link
                            to={`/worlds/${wid}/articles/${e.articleId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {e.articleId.slice(0, 8)}…
                          </Link>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{e.tokensIn.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{e.tokensOut.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{e.iterations ?? '—'}</td>
                      <td className={`px-4 py-2.5 font-medium ${statusColor(e.status)}`}>{e.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40"
                >
                  ← Prev
                </button>
                <span className="text-xs text-gray-500">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
