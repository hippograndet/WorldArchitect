import { useStore } from '../../stores/index.ts';
import SparkConfigView from './SparkConfigView.tsx';
import SolidificationConfigView from './SolidificationConfigView.tsx';
import ForgeProgressView from './ForgeProgressView.tsx';
import AgentLoadingView from './AgentLoadingView.tsx';
import AgentErrorView from './AgentErrorView.tsx';
import ProposalSelectorView from './ProposalSelectorView.tsx';
import ChildProposalSelectorView from './ChildProposalSelectorView.tsx';
import IdeaSelectorView from './IdeaSelectorView.tsx';
import DraftReviewView from './DraftReviewView.tsx';
import AuditResultView from './AuditResultView.tsx';
import ContinuationView from './ContinuationView.tsx';

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

const PHASE_LABELS: Record<string, string> = {
  estimating:       'Estimating…',
  generating:       'Generating…',
  expanding:        'Expanding…',
  proposals_ready:  'Choose Direction',
  ideas_ready:      'Choose Themes',
  reviewing:        'Review',
  continuing:       'What\'s next?',
  forging:          'Forging…',
  forge_done:       'Forge Complete',
  done:             'Done',
  error:            'Error',
};

export default function AgentPanel() {
  const {
    agentPanelOpen, agentPhase, agentTargetArticleTitle,
    agentPipelineType, agentPanelMode,
    closeAgentPanel,
  } = useStore();

  if (!agentPanelOpen) return null;

  const isChildMode = agentPipelineType === 'propose_children';
  const isAudit = agentPipelineType === 'audit';
  const phaseLabel = PHASE_LABELS[agentPhase] ?? '';

  const isForging = agentPhase === 'forging' || agentPhase === 'forge_done';
  const isSpark = agentPanelMode === 'spark';
  const modeLabel = isForging ? '⚙ FORGE' : isSpark ? '✦ SPARK' : '⚙ SOLIDIFY';
  const headerBg  = isForging ? 'bg-amber-50' : isSpark ? 'bg-purple-50' : 'bg-gray-100';
  const modeColor = isForging ? 'text-amber-700' : isSpark ? 'text-purple-700' : 'text-gray-700';
  const phaseColor = isForging ? 'text-amber-400' : isSpark ? 'text-purple-400' : 'text-gray-400';

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-surface border-l border-gray-200 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className={`flex items-start justify-between px-4 py-3 border-b border-gray-100 ${headerBg}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold uppercase tracking-wider ${modeColor}`}>{modeLabel}</span>
            {phaseLabel && <span className={`text-xs ${phaseColor}`}>— {phaseLabel}</span>}
          </div>
          {agentTargetArticleTitle && (
            <p className={`text-xs truncate mt-0.5 max-w-[240px] ${isSpark ? 'text-purple-500' : 'text-gray-500'}`}>
              {agentTargetArticleTitle}
            </p>
          )}
        </div>
        <button
          onClick={closeAgentPanel}
          className={`shrink-0 transition-colors mt-0.5 ${isSpark ? 'text-purple-400 hover:text-purple-700' : 'text-gray-400 hover:text-gray-700'}`}
          title="Close panel"
        >
          <XIcon />
        </button>
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {agentPhase === 'configuring' && (
          isSpark ? <SparkConfigView /> : <SolidificationConfigView />
        )}
        {(agentPhase === 'generating' || agentPhase === 'expanding' || agentPhase === 'estimating') && (
          <AgentLoadingView />
        )}
        {agentPhase === 'proposals_ready' && (
          isChildMode ? <ChildProposalSelectorView /> : <ProposalSelectorView />
        )}
        {agentPhase === 'ideas_ready' && <IdeaSelectorView />}
        {agentPhase === 'reviewing' && (
          isAudit ? <AuditResultView /> : <DraftReviewView />
        )}
        {agentPhase === 'continuing' && <ContinuationView />}
        {(agentPhase === 'forging' || agentPhase === 'forge_done') && <ForgeProgressView />}
        {agentPhase === 'error' && <AgentErrorView />}
        {agentPhase === 'done' && (
          <div className="flex flex-col items-center justify-center gap-2 h-32">
            <p className="text-2xl">✓</p>
            <p className="text-sm text-gray-500">Content accepted</p>
          </div>
        )}
      </div>
    </div>
  );
}
