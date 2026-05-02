import { useStore } from '../../stores/index.ts';
import AgentConfigView from './AgentConfigView.tsx';
import AgentLoadingView from './AgentLoadingView.tsx';
import AgentErrorView from './AgentErrorView.tsx';
import ProposalSelectorView from './ProposalSelectorView.tsx';
import ChildProposalSelectorView from './ChildProposalSelectorView.tsx';
import DraftReviewView from './DraftReviewView.tsx';

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

const PHASE_TITLES: Record<string, string> = {
  configuring:      'Configure',
  estimating:       'Estimating…',
  generating:       'Generating…',
  expanding:        'Expanding…',
  proposals_ready:  'Choose Direction',
  reviewing:        'Review Draft',
  done:             'Done',
  error:            'Error',
};

export default function AgentPanel() {
  const { agentPanelOpen, agentPhase, agentTargetArticleTitle, agentPipelineType, closeAgentPanel } = useStore();

  if (!agentPanelOpen) return null;

  const isChildMode = agentPipelineType === 'propose_children';
  const phaseTitle = PHASE_TITLES[agentPhase] ?? '';

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100 bg-purple-50">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-purple-700 uppercase tracking-wider">AI Agent</span>
            {phaseTitle && <span className="text-xs text-purple-400">— {phaseTitle}</span>}
          </div>
          {agentTargetArticleTitle && (
            <p className="text-xs text-purple-500 truncate mt-0.5 max-w-[240px]">
              {agentTargetArticleTitle}
            </p>
          )}
        </div>
        <button
          onClick={closeAgentPanel}
          className="shrink-0 text-purple-400 hover:text-purple-700 transition-colors mt-0.5"
          title="Close AI Agent panel"
        >
          <XIcon />
        </button>
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {agentPhase === 'configuring' && <AgentConfigView />}
        {(agentPhase === 'generating' || agentPhase === 'expanding' || agentPhase === 'estimating') && (
          <AgentLoadingView />
        )}
        {agentPhase === 'proposals_ready' && (
          isChildMode ? <ChildProposalSelectorView /> : <ProposalSelectorView />
        )}
        {agentPhase === 'reviewing' && <DraftReviewView />}
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
