import { useStore } from '../../stores/index.ts';
import type { NextStep } from '../../stores/agentSlice.ts';

const PIPELINE_ICONS: Record<string, string> = {
  expand_description: '📝',
  expand_chronology:  '📅',
  propose_children:   '🌿',
  create_child:       '✨',
  reorganize:         '🔀',
  summarize:          '🔄',
  improve_intro:      '✍️',
  cohere:             '🔍',
};

export default function ContinuationView() {
  const { agentNextSteps, continueWithStep, closeAgentPanel } = useStore();

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">✓</span>
        <div>
          <p className="text-sm font-semibold text-gray-800">Content accepted</p>
          <p className="text-xs text-gray-400">What would you like to do next?</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {agentNextSteps.map((step: NextStep) => (
          <button
            key={step.pipeline}
            onClick={() => continueWithStep(step)}
            className="text-left p-3 rounded-xl border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{PIPELINE_ICONS[step.pipeline] ?? '→'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-800 group-hover:text-purple-700">{step.label}</p>
                <p className="text-xs text-gray-400">{step.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={closeAgentPanel}
        className="w-full py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
      >
        Done — close panel
      </button>
    </div>
  );
}
