import { useStore } from '../../stores/index.ts';

const PHASE_LABELS: Record<string, string> = {
  generating: 'Generating proposals…',
  expanding: 'Expanding content…',
  estimating: 'Estimating tokens…',
};

export default function AgentLoadingView() {
  const { agentPhase } = useStore();
  const label = PHASE_LABELS[agentPhase] ?? 'Working…';

  return (
    <div className="flex flex-col items-center justify-center gap-4 h-48 px-6">
      <svg className="animate-spin w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}
