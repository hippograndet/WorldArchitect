import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import type { PipelineType } from '../../stores/agentSlice.ts';

const PIPELINES: { value: PipelineType; label: string; desc: string }[] = [
  { value: 'expand_description', label: 'Expand Description',   desc: '3 proposals → write 3-5 paragraphs' },
  { value: 'expand_chronology',  label: 'Expand Chronology',    desc: 'Generate chronological events' },
  { value: 'propose_children',   label: 'Propose Subsections',  desc: '10 child article stubs to pick from' },
  { value: 'create_child',       label: 'Create Child Article', desc: '3 proposals → write a new child' },
  { value: 'reorganize',         label: 'Reorganize',           desc: 'Reorder Description, preserve all facts' },
  { value: 'summarize',          label: 'Refresh Introduction', desc: 'Derive Introduction from Description' },
  { value: 'cohere',             label: 'Coherence Check',      desc: 'Detect contradictions with the world' },
];

const WORD_COUNTS = [
  { value: 'short' as const,  label: 'Short' },
  { value: 'medium' as const, label: 'Medium' },
  { value: 'long' as const,   label: 'Long' },
];

const DETAIL_DEPTHS = [
  { value: 'surface' as const,    label: 'Surface' },
  { value: 'detailed' as const,   label: 'Detailed' },
  { value: 'exhaustive' as const, label: 'Exhaustive' },
];

export default function AgentConfigView() {
  const { wid } = useParams<{ wid: string }>();
  const {
    agentPipelineType, agentParams, agentEstimatedTokens,
    setAgentPipelineType, setAgentParams,
    runAgentGenerate, runAgentEstimate,
    bibleTokenCount, bibleThreshold,
  } = useStore();

  const usesProposals = ['expand_description', 'create_child', 'reorganize'].includes(agentPipelineType);
  const usesUserSpec  = agentPipelineType !== 'propose_children';
  const usesWordCount = ['expand_description', 'create_child', 'reorganize', 'summarize'].includes(agentPipelineType);
  const noParams      = ['cohere', 'propose_children'].includes(agentPipelineType);

  const tokenPct = bibleThreshold > 0 ? Math.round((bibleTokenCount / bibleThreshold) * 100) : 0;

  const handleGenerate = () => {
    if (!wid) return;
    runAgentGenerate(wid).catch(console.error);
  };

  const handleEstimate = () => {
    if (!wid) return;
    runAgentEstimate(wid).catch(console.error);
  };

  const generateLabel = agentPipelineType === 'expand_chronology' || agentPipelineType === 'summarize' || agentPipelineType === 'cohere'
    ? 'Generate'
    : agentPipelineType === 'propose_children'
    ? 'Propose Children'
    : 'Get Proposals';

  return (
    <div className="p-5 flex flex-col gap-5">

      {/* Bible token context */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>Bible: {tokenPct}% used</span>
        <button onClick={handleEstimate} className="text-purple-500 hover:text-purple-700 underline">
          Estimate tokens
        </button>
      </div>
      {agentEstimatedTokens !== null && (
        <p className="text-xs text-gray-500 -mt-3">
          Est. ~{agentEstimatedTokens.toLocaleString()} tokens for this call
        </p>
      )}

      {/* Pipeline selector */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">Task</p>
        <div className="flex flex-col gap-1.5">
          {PIPELINES.map(({ value, label, desc }) => (
            <label
              key={value}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                agentPipelineType === value
                  ? 'border-purple-400 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="pipeline"
                value={value}
                checked={agentPipelineType === value}
                onChange={() => setAgentPipelineType(value)}
                className="mt-0.5 accent-purple-600"
              />
              <div>
                <p className="text-xs font-medium text-gray-800">{label}</p>
                <p className="text-xs text-gray-400">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Parameters */}
      {!noParams && (
        <div className="flex flex-col gap-4 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-600">Parameters</p>

          {usesWordCount && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Length</p>
              <div className="flex gap-1.5">
                {WORD_COUNTS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setAgentParams({ wordCountPreset: value })}
                    className={`flex-1 py-1 text-xs rounded-lg border transition-colors ${
                      agentParams.wordCountPreset === value
                        ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {usesProposals && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Detail depth</p>
              <div className="flex gap-1.5">
                {DETAIL_DEPTHS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setAgentParams({ detailDepth: value })}
                    className={`flex-1 py-1 text-xs rounded-lg border transition-colors ${
                      agentParams.detailDepth === value
                        ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {usesProposals && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Breadth</p>
              <div className="flex gap-1.5">
                {[
                  { value: 'focused' as const, label: 'Focused' },
                  { value: 'connected' as const, label: 'Connected' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setAgentParams({ breadth: value })}
                    className={`flex-1 py-1 text-xs rounded-lg border transition-colors ${
                      agentParams.breadth === value
                        ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {usesUserSpec && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Focus / constraints</p>
              <textarea
                value={agentParams.userSpec}
                onChange={(e) => setAgentParams({ userSpec: e.target.value })}
                rows={3}
                placeholder="e.g. Focus on internal politics, avoid mentioning the war…"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-gray-300"
              />
            </div>
          )}
        </div>
      )}

      {/* Generate CTA */}
      <button
        onClick={handleGenerate}
        className="w-full py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
      >
        {generateLabel}
      </button>
    </div>
  );
}
