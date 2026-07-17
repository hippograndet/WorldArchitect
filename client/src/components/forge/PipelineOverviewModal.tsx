import { useState } from 'react';
import { X } from 'lucide-react';
import AgentStageBoard from './AgentStageBoard.tsx';
import { buildStandardPipelineStages } from './stageModel.ts';
import type { AgentStage } from './stageModel.ts';

export default function PipelineOverviewModal({ onClose }: { onClose: () => void }) {
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  const [stages] = useState<AgentStage[]>(() => buildStandardPipelineStages());
  const selectedStage = stages.find((stage) => stage.key === selectedStageKey) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Forge Pipeline Overview</h3>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
              The full Research → Inception → Expansion → Branching pipeline and every agent in it. This is a
              reference diagram, not a live run — curved arrows show where a checker can send work back for
              revision. Click a stage for what it does.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4">
          <AgentStageBoard
            stages={stages}
            headerLabel="Standard Pipeline"
            articleTitle="Every Forge run follows this shape"
            canResetToCurrent={false}
            onResetToCurrent={() => undefined}
            selectedStageKey={selectedStageKey}
            onToggleStage={(key) => setSelectedStageKey(selectedStageKey === key ? null : key)}
            selectedStage={selectedStage}
            contextDepth="—"
            validationLevel="—"
            standalone
          />
        </div>
      </div>
    </div>
  );
}
