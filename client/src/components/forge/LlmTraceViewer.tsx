import { Code2 } from 'lucide-react';
import { formatTime, formatTracePayload } from './format.ts';
import type { RunLlmTrace } from '../../types/run.ts';

export default function LlmTraceViewer({
  traces,
  selectedTrace,
  onSelectTrace,
  loading,
  error,
  onLoadTraces,
}: {
  traces: RunLlmTrace[];
  selectedTrace: RunLlmTrace | null;
  onSelectTrace: (id: string) => void;
  loading: boolean;
  error: string | null;
  onLoadTraces: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Developer LLM Trace</p>
          <p className="text-xs text-gray-500 mt-1">
            Raw provider exchange for local debugging. Hidden unless dev tools and server tracing are enabled.
          </p>
        </div>
        <button
          onClick={onLoadTraces}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <Code2 size={13} />
          {loading ? 'Loading...' : 'Load Traces'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
          {error}
        </p>
      )}

      {traces.length > 0 && (
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-3">
          <div className="space-y-1.5">
            {traces.map((trace) => (
              <button
                key={trace.id}
                onClick={() => onSelectTrace(trace.id)}
                className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                  selectedTrace?.id === trace.id
                    ? 'border-gray-400 bg-white text-gray-900'
                    : 'border-gray-200 bg-white/70 text-gray-600 hover:bg-white'
                }`}
              >
                <span className="font-semibold">{trace.agentType}</span>
                <span className="text-gray-400"> · {trace.provider} · #{trace.iteration}</span>
                <span className={trace.status === 'error' ? 'block text-red-600' : 'block text-green-700'}>
                  {trace.status} · {formatTime(trace.createdAt)}
                </span>
              </button>
            ))}
          </div>

          {selectedTrace && (
            <div className="min-w-0 space-y-3">
              {selectedTrace.errorMessage && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2">
                  <p className="text-[10px] uppercase tracking-wide text-red-400">Provider Error</p>
                  <p className="text-xs text-red-700 mt-1">{selectedTrace.errorMessage}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Input</p>
                <pre className="max-h-72 overflow-auto rounded-md bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100">
                  {formatTracePayload(selectedTrace.request)}
                </pre>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Output</p>
                <pre className="max-h-72 overflow-auto rounded-md bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100">
                  {formatTracePayload(selectedTrace.response)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
