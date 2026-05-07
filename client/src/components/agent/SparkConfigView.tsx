import type { ReactNode } from 'react';
import { Star, ArrowUp, GitBranch, Lock, Settings, Play } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import { extractDescription } from '../../lib/sections.ts';

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------

type SparkTask = 'inception' | 'expansion' | 'branching';

const TASKS: { id: SparkTask; label: string; desc: string }[] = [
  { id: 'inception', label: 'Inception',  desc: 'Generate a complete Introduction from the article name and world context.' },
  { id: 'expansion', label: 'Expansion',  desc: 'Write the full Description using creative proposals and thematic ideas.' },
  { id: 'branching', label: 'Branching',  desc: 'Propose 10 child articles to branch this node into subsections.' },
];

const TASK_ICON: Record<SparkTask, ReactNode> = {
  inception: <Star size={16} />,
  expansion: <ArrowUp size={16} />,
  branching: <GitBranch size={16} />,
};

const TASK_TO_PIPELINE = {
  inception: 'summarize',
  expansion: 'forge_expand',
  branching: 'propose_children',
} as const;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SparkConfigView() {
  const { wid } = useParams<{ wid: string }>();
  const {
    agentPipelineType, agentParams, agentEstimatedTokens,
    setAgentPipelineType, setAgentParams,
    runAgentGenerate, runAgentEstimate, startForge,
    currentArticleDetail,
    treeNodes, bibleTokenCount,
  } = useStore();

  // Determine which task is currently selected
  const selectedTask: SparkTask =
    agentPipelineType === 'summarize' || agentPipelineType === 'improve_intro' ? 'inception' :
    agentPipelineType === 'forge_expand' || agentPipelineType === 'expand_description' ? 'expansion' :
    'branching';

  // Prerequisite checks
  const introText = currentArticleDetail?.introduction ?? '';
  const descText  = extractDescription(currentArticleDetail?.version?.body ?? '');
  const introWords = countWords(introText);
  const descWords  = countWords(descText);

  const INTRO_MIN = 15;
  const DESC_MIN  = 40;

  const availability = {
    inception: { ok: true, reason: '' },
    expansion: {
      ok: introWords >= INTRO_MIN,
      reason: introWords < INTRO_MIN
        ? `Need at least ${INTRO_MIN} words in the Introduction (currently ${introWords})`
        : '',
    },
    branching: {
      ok: introWords >= INTRO_MIN && descWords >= DESC_MIN,
      reason: introWords < INTRO_MIN
        ? `Need at least ${INTRO_MIN} words in the Introduction`
        : descWords < DESC_MIN
          ? `Need at least ${DESC_MIN} words in the Description (currently ${descWords})`
          : '',
    },
  };

  const handleSelectTask = (task: SparkTask) => {
    if (!availability[task].ok) return;
    setAgentPipelineType(TASK_TO_PIPELINE[task]);
  };

  const handleGenerate = () => {
    if (!wid) return;
    if (agentParams.forgeEnabled) {
      startForge(wid).catch(console.error);
    } else {
      runAgentGenerate(wid).catch(console.error);
    }
  };

  const handleEstimate = () => {
    if (!wid) return;
    runAgentEstimate(wid).catch(console.error);
  };

  const worldInfo = `${treeNodes.length} article${treeNodes.length !== 1 ? 's' : ''} · ~${(bibleTokenCount / 1000).toFixed(1)}k tokens Bible`;

  const ctaTaskLabel =
    selectedTask === 'inception' ? 'Start Inception' :
    selectedTask === 'expansion' ? 'Start Expansion' :
    'Start Branching';

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* Task cards */}
      <div className="p-4 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Task</p>
        <div className="flex gap-2">
          {TASKS.map((t) => {
            const avail = availability[t.id];
            const isSelected = selectedTask === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleSelectTask(t.id)}
                title={avail.ok ? t.desc : avail.reason}
                disabled={!avail.ok}
                className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-lg border text-center transition-colors
                  ${isSelected
                    ? 'border-purple-400 bg-purple-50 text-purple-700'
                    : avail.ok
                      ? 'border-gray-200 hover:border-purple-300 hover:bg-purple-50 text-gray-700 cursor-pointer'
                      : 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                  }`}
              >
                <span className="flex items-center justify-center">{avail.ok ? TASK_ICON[t.id] : <Lock size={16} />}</span>
                <span className="text-xs font-medium">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Lock reason */}
        {!availability[selectedTask].ok && (
          <p className="mt-2 text-xs text-amber-600">{availability[selectedTask].reason}</p>
        )}
      </div>

      {/* Task-specific params */}
      {selectedTask === 'expansion' && !agentParams.forgeEnabled && (
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Description Length</p>
          <div className="flex gap-2">
            {(['short', 'medium', 'long'] as const).map((p, i) => {
              const labels = ['3 §', '5 §', '7 §'];
              return (
                <button
                  key={p}
                  onClick={() => setAgentParams({ wordCountPreset: p })}
                  className={`flex-1 py-1.5 text-xs rounded border transition-colors
                    ${agentParams.wordCountPreset === p
                      ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                >
                  {labels[i]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedTask === 'branching' && !agentParams.forgeEnabled && (
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Child Type</p>
          <div className="flex gap-2">
            {([
              { val: 'conceptual' as const, label: 'Conceptual', hint: 'Categories, systems, types' },
              { val: 'specific'   as const, label: 'Specific',   hint: 'Named entities, instances' },
            ]).map((opt) => (
              <button
                key={opt.val}
                onClick={() => setAgentParams({ branchingMode: opt.val })}
                title={opt.hint}
                className={`flex-1 py-1.5 text-xs rounded border transition-colors
                  ${agentParams.branchingMode === opt.val
                    ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            {agentParams.branchingMode === 'specific'
              ? 'Named entities, real examples (e.g. Technology → Apple Inc.)'
              : 'Abstract categories, systems (e.g. World → Technology)'}
          </p>
        </div>
      )}

      {/* Shared params */}
      <div className="px-4 py-3 border-b border-gray-100 flex flex-col gap-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Shared</p>

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
                    ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">{worldInfo}</p>
        </div>

        {/* Include current content */}
        {!agentParams.forgeEnabled && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agentParams.includeCurrentContent}
              onChange={(e) => setAgentParams({ includeCurrentContent: e.target.checked })}
              className="accent-purple-600"
            />
            <span className="text-xs text-gray-700">Include current content</span>
            <span className="text-xs text-gray-400">(for improvement vs. fresh start)</span>
          </label>
        )}

        {/* Auto-chain */}
        {!agentParams.forgeEnabled && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agentParams.autoChain}
              onChange={(e) => setAgentParams({ autoChain: e.target.checked })}
              className="accent-purple-600"
            />
            <span className="text-xs text-gray-700">Auto-chain all steps</span>
            <span className="text-xs text-gray-400">(skip "what's next?" prompt)</span>
          </label>
        )}

        {/* Guidance */}
        {!agentParams.forgeEnabled && (
          <div>
            <p className="text-xs text-gray-600 mb-1">Guidance</p>
            <textarea
              value={agentParams.userSpec}
              onChange={(e) => setAgentParams({ userSpec: e.target.value })}
              rows={2}
              placeholder={selectedTask === 'branching' ? 'e.g. focus on military factions…' : 'Additional direction or constraints…'}
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-gray-300"
            />
          </div>
        )}
      </div>

      {/* ── Recursive Forge section ── */}
      <div className="px-4 py-3 border-b border-gray-100 flex flex-col gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agentParams.forgeEnabled}
            onChange={(e) => setAgentParams({ forgeEnabled: e.target.checked })}
            className="accent-amber-500"
          />
          <span className="text-xs font-semibold text-amber-700">Recursive Forge</span>
          <span className="text-xs text-gray-400">— fully automated, no review steps</span>
        </label>

        {agentParams.forgeEnabled && (
          <div className="flex flex-col gap-3 pl-1">
            {/* Traversal mode */}
            <div>
              <p className="text-xs text-gray-600 mb-1.5">Traversal</p>
              <div className="flex gap-2">
                {([
                  { val: 'breadth' as const, label: 'Breadth', hint: 'Populate all siblings before going deeper' },
                  { val: 'depth'   as const, label: 'Depth',   hint: 'Go as deep as possible on first child before backtracking' },
                ]).map((opt) => (
                  <button
                    key={opt.val}
                    onClick={() => setAgentParams({ forgeMode: opt.val })}
                    title={opt.hint}
                    className={`flex-1 py-1.5 text-xs rounded border transition-colors
                      ${agentParams.forgeMode === opt.val
                        ? 'border-amber-400 bg-amber-50 text-amber-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {agentParams.forgeMode === 'breadth'
                  ? 'All children populated → all grandchildren → …'
                  : 'One child expanded fully → next child → …'}
              </p>
            </div>

            {/* Max depth */}
            <div>
              <p className="text-xs text-gray-600 mb-1.5">Depth (extra levels)</p>
              <div className="flex gap-2">
                {[1, 2, 3].map((d) => (
                  <button
                    key={d}
                    onClick={() => setAgentParams({ forgeMaxDepth: d })}
                    className={`flex-1 py-1.5 text-xs rounded border transition-colors
                      ${agentParams.forgeMaxDepth === d
                        ? 'border-amber-400 bg-amber-50 text-amber-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                  >
                    +{d}
                  </button>
                ))}
              </div>
            </div>

            {/* Max children */}
            <div>
              <p className="text-xs text-gray-600 mb-1.5">Children per node</p>
              <div className="flex gap-2">
                {[3, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setAgentParams({ forgeMaxChildren: n })}
                    className={`flex-1 py-1.5 text-xs rounded border transition-colors
                      ${agentParams.forgeMaxChildren === n
                        ? 'border-amber-400 bg-amber-50 text-amber-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Child type */}
            <div>
              <p className="text-xs text-gray-600 mb-1.5">Child type</p>
              <div className="flex gap-2">
                {([
                  { val: 'conceptual' as const, label: 'Conceptual' },
                  { val: 'specific'   as const, label: 'Specific' },
                ]).map((opt) => (
                  <button
                    key={opt.val}
                    onClick={() => setAgentParams({ branchingMode: opt.val })}
                    className={`flex-1 py-1.5 text-xs rounded border transition-colors
                      ${agentParams.branchingMode === opt.val
                        ? 'border-amber-400 bg-amber-50 text-amber-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Estimated scope */}
            <div className="bg-amber-50 border border-amber-200 rounded p-2">
              <p className="text-xs text-amber-700">
                <strong>Estimated scope:</strong>{' '}
                up to {estimateForgeScope(agentParams.forgeMaxChildren, agentParams.forgeMaxDepth)} articles,{' '}
                {estimateForgeScope(agentParams.forgeMaxChildren, agentParams.forgeMaxDepth) * 3} LLM calls.
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Fully automated — no user input during the run.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="p-4 flex flex-col gap-2">
        {agentEstimatedTokens !== null && !agentParams.forgeEnabled && (
          <p className="text-xs text-gray-400 text-center">~{agentEstimatedTokens.toLocaleString()} tokens estimated</p>
        )}
        <button
          onClick={handleGenerate}
          disabled={!availability[selectedTask].ok}
          className={`w-full py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
            agentParams.forgeEnabled
              ? 'bg-amber-500 hover:bg-amber-600'
              : 'bg-purple-600 hover:bg-purple-700'
          }`}
        >
          <span className="flex items-center justify-center gap-1.5">
            {agentParams.forgeEnabled ? <Settings size={14} /> : <Play size={14} />}
            {agentParams.forgeEnabled ? 'Start Forge' : ctaTaskLabel}
          </span>
        </button>
        {!agentParams.forgeEnabled && (
          <button
            onClick={handleEstimate}
            className="w-full py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            ~ Estimate tokens
          </button>
        )}
      </div>
    </div>
  );
}

// Rough upper-bound estimate: 1 start node + sum of children at each depth level
function estimateForgeScope(maxChildren: number, maxDepth: number): number {
  let total = 1; // start node
  for (let d = 1; d <= maxDepth; d++) {
    total += Math.pow(maxChildren, d);
  }
  return total;
}
