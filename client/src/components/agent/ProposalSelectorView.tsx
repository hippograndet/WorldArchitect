import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';

export default function ProposalSelectorView() {
  const { wid } = useParams<{ wid: string }>();
  const {
    agentProposals, agentSelectedProposalIndex,
    selectAgentProposal, runAgentExpand, agentRetry,
    agentPipelineType,
  } = useStore();

  const handleExpand = () => {
    if (!wid) return;
    runAgentExpand(wid).catch(console.error);
  };

  const canExpand = agentSelectedProposalIndex !== null;

  // reorganize goes directly (no proposal needed – server returns result)
  const expandLabel = agentPipelineType === 'reorganize' ? 'Reorganize' : 'Expand Selected';

  return (
    <div className="p-5 flex flex-col gap-4">
      <p className="text-xs font-semibold text-gray-600">Choose a direction</p>

      <div className="flex flex-col gap-3">
        {agentProposals.map((p, i) => (
          <button
            key={i}
            onClick={() => selectAgentProposal(i)}
            className={`text-left p-3 rounded-xl border transition-colors ${
              agentSelectedProposalIndex === i
                ? 'border-purple-400 bg-purple-50 ring-1 ring-purple-300'
                : 'border-gray-200 hover:border-gray-300 bg-white'
            }`}
          >
            <p className="text-xs font-semibold text-gray-800 mb-1">{p.title}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{p.direction}</p>
          </button>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleExpand}
          disabled={!canExpand}
          className="flex-1 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {expandLabel}
        </button>
        <button
          onClick={agentRetry}
          className="px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
          title="Back to configuration"
        >
          ←
        </button>
      </div>
    </div>
  );
}
