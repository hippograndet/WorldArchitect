import type { ReactNode } from 'react';
import { RotateCcw, Scale } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import type { PipelineType } from '../../stores/agentSlice.ts';

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------

type SolidTask = 'reorganize' | 'cohere';

const TASKS: { id: SolidTask; pipeline: PipelineType; label: string; desc: string }[] = [
  {
    id: 'reorganize', pipeline: 'reorganize',
    label: 'Reorganize',
    desc: 'Restructure and improve the existing Description while preserving all facts.',
  },
  {
    id: 'cohere', pipeline: 'cohere',
    label: 'Coherence Check',
    desc: 'Scan for contradictions between this article and the rest of the world.',
  },
];

const TASK_ICON: Record<SolidTask, ReactNode> = {
  reorganize: <RotateCcw size={16} />,
  cohere: <Scale size={16} />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SolidificationConfigView() {
  const { wid } = useParams<{ wid: string }>();
  const {
    agentPipelineType, agentParams,
    setAgentPipelineType, setAgentParams,
    runAgentGenerate,
    treeNodes, bibleTokenCount,
  } = useStore();

  const selectedTask: SolidTask = agentPipelineType === 'cohere' ? 'cohere' : 'reorganize';

  const handleSelectTask = (task: SolidTask) => {
    setAgentPipelineType(TASKS.find((t) => t.id === task)!.pipeline);
  };

  const handleGenerate = () => {
    if (!wid) return;
    runAgentGenerate(wid).catch(console.error);
  };

  const worldInfo = `${treeNodes.length} article${treeNodes.length !== 1 ? 's' : ''} · ~${(bibleTokenCount / 1000).toFixed(1)}k tokens Bible`;

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* Task cards */}
      <div className="p-4 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Task</p>
        <div className="flex gap-2">
          {TASKS.map((t) => {
            const isSelected = selectedTask === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleSelectTask(t.id)}
                title={t.desc}
                className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-lg border text-center transition-colors
                  ${isSelected
                    ? 'border-gray-500 bg-gray-100 text-gray-800'
                    : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50 text-gray-600 cursor-pointer'
                  }`}
              >
                <span className="flex items-center justify-center">{TASK_ICON[t.id]}</span>
                <span className="text-xs font-medium">{t.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          {TASKS.find((t) => t.id === selectedTask)?.desc}
        </p>
      </div>

      {/* Shared params */}
      <div className="px-4 py-3 border-b border-gray-100 flex flex-col gap-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Parameters</p>

        {/* Context depth */}
        <div>
          <p className="text-xs text-gray-600 mb-1.5">Context Amount</p>
          <div className="flex gap-2 mb-1">
            {([
              { val: 'shallow' as const, label: 'Shallow' },
              { val: 'mid'     as const, label: 'Medium'  },
              { val: 'deep'    as const, label: 'Deep'    },
            ]).map((opt) => (
              <button
                key={opt.val}
                onClick={() => setAgentParams({ contextDepth: opt.val })}
                className={`flex-1 py-1 text-xs rounded border transition-colors
                  ${agentParams.contextDepth === opt.val
                    ? 'border-gray-500 bg-gray-100 text-gray-800 font-medium'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">{worldInfo}</p>
        </div>

        {/* Guidance — only for reorganize */}
        {selectedTask === 'reorganize' && (
          <div>
            <p className="text-xs text-gray-600 mb-1">Guidance</p>
            <textarea
              value={agentParams.userSpec}
              onChange={(e) => setAgentParams({ userSpec: e.target.value })}
              rows={2}
              placeholder="e.g. make it more chronological, cut the backstory…"
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs resize-none focus:outline-none focus:ring-2 focus:ring-gray-300 placeholder:text-gray-300"
            />
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="p-4">
        <button
          onClick={handleGenerate}
          className="w-full py-2 text-sm font-medium bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors"
        >
          <span className="flex items-center justify-center gap-1.5">
            {TASK_ICON[selectedTask]}
            {selectedTask === 'reorganize' ? 'Reorganize' : 'Check Coherence'}
          </span>
        </button>
      </div>
    </div>
  );
}
