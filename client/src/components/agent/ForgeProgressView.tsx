import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';

const STEP_ICON: Record<string, string> = {
  Inception: '★',
  Expansion: '↑',
  Branching: '⤆',
};

export default function ForgeProgressView() {
  const { wid } = useParams<{ wid: string }>();
  const {
    agentParams,
    forgeRunning, forgePaused,
    forgeQueue, forgeLog,
    forgeCurrentTitle, forgeCurrentStep,
    forgeCompleted, forgeTotal,
    pauseForge, resumeForge, stopForge,
  } = useStore();

  const isDone = !forgeRunning && !forgePaused;
  const progress = forgeTotal > 0 ? Math.round((forgeCompleted / forgeTotal) * 100) : 0;
  const modeLabel = agentParams.forgeMode === 'breadth' ? 'Breadth-first' : 'Depth-first';

  const handlePauseResume = () => {
    if (!wid) return;
    if (forgePaused) {
      resumeForge(wid).catch(console.error);
    } else {
      pauseForge();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Progress header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
            {isDone ? 'Forge Complete' : forgePaused ? 'Paused' : 'Forging…'}
          </p>
          <p className="text-xs text-gray-500">{modeLabel}</p>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
          <div
            className={`h-full rounded-full transition-all ${
              isDone ? 'bg-green-400' : forgePaused ? 'bg-amber-300' : 'bg-amber-400'
            }`}
            style={{ width: `${isDone && forgeTotal === 0 ? 100 : progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-400">
          {forgeCompleted} / {forgeTotal} articles · {forgeQueue.length} queued
        </p>

        {/* Current step */}
        {!isDone && (forgeCurrentTitle || forgePaused) && (
          <p className="mt-2 text-xs text-gray-600 truncate">
            {forgePaused
              ? `Paused — ${forgeQueue.length} articles remaining`
              : `${forgeCurrentStep ?? '…'}: ${forgeCurrentTitle}`}
          </p>
        )}
        {isDone && forgeTotal > 0 && (
          <p className="mt-2 text-xs text-green-700 font-medium">
            All {forgeCompleted} article{forgeCompleted !== 1 ? 's' : ''} processed.
          </p>
        )}

        {/* Controls */}
        {!isDone && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={handlePauseResume}
              className={`flex-1 py-1.5 text-xs rounded border font-medium transition-colors ${
                forgePaused
                  ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {forgePaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button
              onClick={stopForge}
              className="flex-1 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
            >
              ■ Stop
            </button>
          </div>
        )}
      </div>

      {/* Activity log */}
      <div className="flex-1 overflow-y-auto p-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">Activity</p>
        {forgeLog.length === 0 ? (
          <p className="text-xs text-gray-400 px-1">
            {forgeRunning ? 'Starting…' : 'No activity yet.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {forgeLog.map((entry, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 py-1 px-1.5 rounded text-xs ${
                  entry.ok ? '' : 'bg-red-50'
                }`}
              >
                <span className={`shrink-0 ${entry.ok ? 'text-gray-400' : 'text-red-500'}`}>
                  {entry.ok ? (STEP_ICON[entry.step] ?? '·') : '✕'}
                </span>
                <div className="min-w-0 flex-1">
                  <span className={`font-medium ${entry.ok ? 'text-gray-700' : 'text-red-600'}`}>
                    {entry.step}
                  </span>
                  <span className="text-gray-500 ml-1 truncate block">{entry.title}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
