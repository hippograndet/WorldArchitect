import { useStore } from '../../stores/index.ts';

export default function AgentErrorView() {
  const { agentError, agentRetry, closeAgentPanel } = useStore();

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-xs font-semibold text-red-700 mb-1">Agent error</p>
        <p className="text-xs text-red-600">{agentError ?? 'An unknown error occurred.'}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={agentRetry}
          className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium"
        >
          Retry
        </button>
        <button
          onClick={closeAgentPanel}
          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}
