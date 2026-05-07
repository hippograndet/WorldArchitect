import { Loader2 } from 'lucide-react';
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
      <Loader2 size={24} className="animate-spin text-purple-500" />
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}
