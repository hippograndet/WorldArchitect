import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';

export default function IdeaSelectorView() {
  const { wid } = useParams<{ wid: string }>();
  const {
    agentIdeas, agentSelectedIdeas,
    toggleAgentIdea, clearAgentIdeas, backToProposals,
    runAgentExpand,
  } = useStore();

  const handleExpand = () => {
    if (!wid || agentSelectedIdeas.length === 0) return;
    runAgentExpand(wid).catch(console.error);
  };

  const allSelected = agentIdeas.length > 0 && agentSelectedIdeas.length === agentIdeas.length;

  const handleToggleAll = () => {
    if (allSelected) {
      clearAgentIdeas();
    } else {
      agentIdeas.forEach((idea) => {
        if (!agentSelectedIdeas.find((s) => s.id === idea.id)) {
          toggleAgentIdea(idea);
        }
      });
    }
  };

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-600">Choose themes to incorporate</p>
        <button
          onClick={handleToggleAll}
          className="text-xs text-purple-500 hover:text-purple-700 underline"
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {agentIdeas.map((idea) => {
          const isSelected = agentSelectedIdeas.some((s) => s.id === idea.id);
          return (
            <label
              key={idea.id}
              className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                isSelected ? 'border-purple-400 bg-purple-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleAgentIdea(idea)}
                className="mt-0.5 accent-purple-600 shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-800">{idea.theme}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{idea.detail}</p>
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleExpand}
          disabled={agentSelectedIdeas.length === 0}
          className="flex-1 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Expand with {agentSelectedIdeas.length > 0 ? agentSelectedIdeas.length : ''} theme{agentSelectedIdeas.length !== 1 ? 's' : ''}
        </button>
        <button
          onClick={backToProposals}
          className="px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
          title="Back to proposals"
        >
          ←
        </button>
      </div>
    </div>
  );
}
