import LabelBadge from '../shared/LabelBadge.tsx';
import { formatTime } from './format.ts';
import {
  stageStatusClass,
  stageStatusLabel,
  stageStatusDotClass,
  stageTaskLabel,
  stageStatusSentence,
  stageDiagnosticNote,
  AGENT_LABELS,
} from './stageModel.ts';
import type { AgentStage, AgentStageStep } from './stageModel.ts';

export default function AgentStageBoard({
  stages,
  headerLabel,
  articleTitle,
  canResetToCurrent,
  onResetToCurrent,
  selectedStageKey,
  onToggleStage,
  selectedStage,
  contextDepth,
  validationLevel,
}: {
  stages: AgentStage[];
  headerLabel: string;
  articleTitle: string;
  canResetToCurrent: boolean;
  onResetToCurrent: () => void;
  selectedStageKey: string | null;
  onToggleStage: (key: string) => void;
  selectedStage: AgentStage | null;
  contextDepth: string;
  validationLevel: string;
}) {
  const selectedStageIndex = selectedStage ? stages.findIndex((stage) => stage.key === selectedStage.key) : -1;
  const selectedStageContinues = selectedStageIndex >= 0 && selectedStageIndex < stages.length - 1;
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{headerLabel}</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">{articleTitle}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {stages.filter((stage) => stage.status === 'completed').length} / {stages.length} stages completed
          </p>
        </div>
        {canResetToCurrent && (
          <button
            onClick={onResetToCurrent}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50"
          >
            Show Current
          </button>
        )}
      </div>

      {stages.length === 0 ? (
        <p className="text-xs text-gray-400">No pipeline plan is available for this article.</p>
      ) : (
        <div className="flex flex-wrap items-stretch gap-2">
          {(['research', 'inception', 'expansion', 'branching'] as AgentStageStep[]).reduce<JSX.Element[]>((acc, step) => {
            const stepStages = stages.filter((stage) => stage.step === step);
            if (stepStages.length === 0) return acc;
            if (acc.length > 0) {
              acc.push(
                <div key={`arrow-${step}`} className="hidden md:flex items-center justify-center text-gray-300 shrink-0" aria-hidden="true">
                  <span className="text-lg leading-none">→</span>
                </div>,
              );
            }
            acc.push(
              <div key={step} className="flex-1 min-w-[180px] rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold text-gray-800 capitalize mb-2">{step}</p>
                <div className="space-y-2">
                  {stepStages.map((stage) => {
                    const hasRetryLoop = typeof stage.retryMax === 'number' && stage.retryMax > 0;
                    return (
                      <button
                        key={stage.key}
                        onClick={() => onToggleStage(stage.key)}
                        className={`w-full rounded-md border p-2 text-left transition-colors ${
                          selectedStageKey === stage.key
                            ? 'border-purple-300 bg-purple-50'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">{stage.label}</p>
                            <span className="text-[10px] text-gray-300">-</span>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 truncate">{stageTaskLabel(stage)}</p>
                          </div>
                          <span
                            aria-label={stageStatusLabel(stage.status)}
                            className={`h-2.5 w-2.5 rounded-full shrink-0 ${stageStatusDotClass(stage.status)}`}
                          />
                        </div>
                        <p className={`text-xs mt-2 leading-relaxed ${
                          stage.status === 'failed' ? 'text-red-700' :
                          stage.status === 'running' ? 'text-amber-700' :
                          'text-gray-500'
                        }`}>
                          {stageStatusSentence(stage)}
                        </p>
                        {hasRetryLoop && (
                          <p className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-1" title={`Sends back to ${AGENT_LABELS[stage.retryGeneratorAgentType ?? ''] ?? stage.retryGeneratorAgentType} for revision`}>
                            <span aria-hidden="true">↩</span>
                            <span>
                              {AGENT_LABELS[stage.retryGeneratorAgentType ?? ''] ?? stage.retryGeneratorAgentType} revisions: {stage.retryActual ?? 0}/{stage.retryMax}
                            </span>
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>,
            );
            return acc;
          }, [])}
        </div>
      )}

      <div className="mt-4 border-t border-gray-100 pt-4">
        {!selectedStage ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-semibold text-gray-700">Stage Details</p>
            <p className="text-xs text-gray-400 mt-1">Click a MAS stage above to inspect its run data.</p>
          </div>
        ) : (
          <div className={`rounded-lg border p-4 ${
            selectedStage.status === 'failed'
              ? 'border-red-200 bg-red-50'
              : selectedStage.status === 'running'
                ? 'border-blue-200 bg-blue-50'
                : 'border-gray-200 bg-gray-50'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stage Details</p>
                <h4 className="text-sm font-semibold text-gray-900 mt-1">{selectedStage.label}</h4>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedStage.step} · {stageTaskLabel(selectedStage)}
                </p>
              </div>
              <LabelBadge
                label={stageStatusLabel(selectedStage.status)}
                colorClass={stageStatusClass(selectedStage.status)}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Task</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">{stageTaskLabel(selectedStage)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Recorded</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">
                  {selectedStage.call ? formatTime(selectedStage.call.createdAt) : 'Not yet'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Attempts</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">
                  {typeof selectedStage.call?.iterations === 'number' ? selectedStage.call.iterations : '-'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Tokens</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">
                  {selectedStage.call
                    ? ((selectedStage.call.tokensIn ?? 0) + (selectedStage.call.tokensOut ?? 0)).toLocaleString()
                    : '-'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Agent Id</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">{selectedStage.agentType}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Context</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">{contextDepth}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Validation</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">{validationLevel}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Continue</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">{String(selectedStageContinues)}</p>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">
                {selectedStage.status === 'failed' ? 'What went wrong' : 'Status'}
              </p>
              <p className={`text-xs mt-1 leading-relaxed ${
                selectedStage.status === 'failed' ? 'text-red-700' : 'text-gray-600'
              }`}>
                {stageDiagnosticNote(selectedStage)}
              </p>
            </div>

            {selectedStage.status === 'failed' && (
              <div className="mt-3 rounded-md border border-red-200 bg-white/70 p-3">
                <p className="text-[10px] uppercase tracking-wide text-red-400">Useful Checks</p>
                <p className="text-xs text-red-700 mt-1 leading-relaxed">
                  Retry with the same parameters, lower context depth, or use Manual/Assisted validation if the failed stage produced unusable output.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
