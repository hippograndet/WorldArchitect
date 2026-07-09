import { useEffect, useMemo, useState } from 'react';
import { ArrowUp, Code2, GitBranch, PanelRightClose, PanelRightOpen, Play, RotateCcw, Settings, Star } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../stores/index.ts';
import { api } from '../lib/api.ts';
import type { TreeNode } from '../lib/tree.ts';
import type { PipelineType } from '../stores/agentSlice.ts';
import type { Run, RunAgentCall, RunConfig, RunLlmTrace, RunReviewItem, RunWithEvents } from '../types/run.ts';
import SettingGroup from '../components/shared/SettingGroup.tsx';
import LabelBadge from '../components/shared/LabelBadge.tsx';
import WorkspaceLayout from '../components/shared/WorkspaceLayout.tsx';

type PipelineStartStep = 'inception' | 'expansion' | 'branching';
type ContinuationMode = 'one_step' | 'finish_document' | 'recursive';
type ValidationLevel = 'manual' | 'assisted' | 'autopilot';
type ExistingContentMode = 'create' | 'improve' | 'replace' | 'skip_existing';
type BranchingExistingMode = 'append_deduped' | 'skip_if_children';
type AgentStageStatus = 'completed' | 'failed' | 'running' | 'pending' | 'skipped';

const DEV_LLM_TRACE_VIEWER = import.meta.env.DEV && import.meta.env.VITE_WORLDARCHITECT_DEV_TOOLS === '1';

interface AgentStage {
  key: string;
  step: PipelineStartStep;
  group: string;
  agentType: string;
  label: string;
  status: AgentStageStatus;
  call?: RunAgentCall;
  detail?: string;
}

const START_STEPS: Array<{
  id: PipelineStartStep;
  label: string;
  icon: typeof Star;
  description: string;
}> = [
  {
    id: 'inception',
    label: 'Inception',
    icon: Star,
    description: 'Generate or improve the starting document introduction.',
  },
  {
    id: 'expansion',
    label: 'Expansion',
    icon: ArrowUp,
    description: 'Expand one document into fuller descriptive canon.',
  },
  {
    id: 'branching',
    label: 'Branching',
    icon: GitBranch,
    description: 'Propose child documents below the starting node.',
  },
];

const CONTINUE_MODES: Array<{
  id: ContinuationMode;
  label: string;
  description: string;
}> = [
  {
    id: 'one_step',
    label: 'One step',
    description: 'Run only the selected starting step.',
  },
  {
    id: 'finish_document',
    label: 'Finish document',
    description: 'Continue through the remaining steps for the selected document only.',
  },
  {
    id: 'recursive',
    label: 'Recursive',
    description: 'Continue into created child documents according to recursion settings.',
  },
];

const EXISTING_CONTENT_MODES: Array<{
  id: ExistingContentMode;
  label: string;
  description: string;
}> = [
  { id: 'create', label: 'Create if empty', description: 'Create content when empty; skip if content already exists.' },
  { id: 'improve', label: 'Improve current', description: 'Use existing content as context and improve it.' },
  { id: 'replace', label: 'Replace completely', description: 'Generate a replacement instead of preserving the current wording.' },
  { id: 'skip_existing', label: 'Skip existing', description: 'Do not run this step when content already exists.' },
];

const VALIDATION_LEVELS: Array<{
  id: ValidationLevel;
  label: string;
  description: string;
}> = [
  {
    id: 'manual',
    label: 'Manual',
    description: 'Keep generated document drafts for user review before acceptance.',
  },
  {
    id: 'assisted',
    label: 'Assisted',
    description: 'Auto-select likely directions, but keep generated document drafts for review.',
  },
  {
    id: 'autopilot',
    label: 'Autopilot',
    description: 'Automate choices and continue without user checkpoints during the run.',
  },
];

const RUN_STATUS_LABELS: Record<Run['status'], string> = {
  pending: 'Queued',
  running: 'In progress',
  paused: 'Paused',
  needs_input: 'Needs input',
  completed: 'Finished successfully',
  stopped: 'Finished unsuccessfully',
  failed: 'Finished unsuccessfully',
};

const AGENT_LABELS: Record<string, string> = {
  context_assembly: 'Context Assembly',
  lorekeeper: 'Lorekeeper',
  grounding_check: 'Grounding Check',
  muse: 'Muse',
  curator: 'Curator',
  oracle: 'Oracle',
  researcher: 'Researcher',
  scribe: 'Scribe',
  continuity_editor: 'Continuity Editor',
  cartographer: 'Cartographer',
  dedup_check: 'Dedup Check',
};

const AGENT_TASKS: Record<string, string> = {
  context_assembly: 'Context',
  lorekeeper: 'Intro',
  grounding_check: 'Grounding',
  muse: 'Direction',
  curator: 'Select',
  oracle: 'Ideas',
  researcher: 'Research',
  scribe: 'Draft',
  continuity_editor: 'Continuity',
  cartographer: 'Children',
  dedup_check: 'Dedup',
};

interface FlatNode {
  id: string;
  title: string;
  depth: number;
  status: string;
}

function flattenTree(nodes: TreeNode[]): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (items: TreeNode[]) => {
    for (const node of items) {
      out.push({ id: node.id, title: node.title, depth: node.depth, status: node.status });
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

function estimateRecursiveScope(maxChildren: number, maxDepth: number): number {
  const branchFactor = maxChildren > 0 ? maxChildren : 5;
  let total = 1;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    total += Math.pow(branchFactor, depth);
  }
  return total;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function depthBehaviorLabel(depth: number): string {
  if (depth <= 1) {
    return 'Selected node is incepted, expanded, and branched; created children are incepted and expanded only.';
  }
  return `Branching continues through level +${depth}; the final created level is incepted and expanded, but not branched.`;
}

function formatTime(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'Pending';
  const milliseconds = ts < 1_000_000_000_000 ? ts * 1000 : ts;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return 'Pending';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatTracePayload(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function payloadChildren(payload: Record<string, unknown>): Array<{ title: string; introduction: string; templateType: string }> {
  const value = payload.children;
  if (!Array.isArray(value)) return [];
  return value
    .filter((child): child is Record<string, unknown> => Boolean(child) && typeof child === 'object' && !Array.isArray(child))
    .map((child) => ({
      title: typeof child.title === 'string' ? child.title : '',
      introduction: typeof child.introduction === 'string' ? child.introduction : '',
      templateType: typeof child.templateType === 'string' ? child.templateType : 'general',
    }))
    .filter((child) => child.title.trim().length > 0);
}

function payloadProposals(payload: Record<string, unknown>): Array<{ title: string; direction: string }> {
  const value = payload.proposals;
  if (!Array.isArray(value)) return [];
  return value
    .filter((proposal): proposal is Record<string, unknown> => Boolean(proposal) && typeof proposal === 'object' && !Array.isArray(proposal))
    .map((proposal) => ({
      title: typeof proposal.title === 'string' ? proposal.title : '',
      direction: typeof proposal.direction === 'string' ? proposal.direction : '',
    }))
    .filter((proposal) => proposal.title.trim().length > 0 || proposal.direction.trim().length > 0);
}

function payloadIdeas(payload: Record<string, unknown>): Array<{ id: string; theme: string; detail: string }> {
  const value = payload.ideas;
  if (!Array.isArray(value)) return [];
  return value
    .filter((idea): idea is Record<string, unknown> => Boolean(idea) && typeof idea === 'object' && !Array.isArray(idea))
    .map((idea, index) => ({
      id: typeof idea.id === 'string' ? idea.id : `idea-${index}`,
      theme: typeof idea.theme === 'string' ? idea.theme : '',
      detail: typeof idea.detail === 'string' ? idea.detail : '',
    }))
    .filter((idea) => idea.theme.trim().length > 0 || idea.detail.trim().length > 0);
}

function reviewTitle(review: RunReviewItem): string {
  if (review.kind === 'intro_review') return 'Review Introduction';
  if (review.kind === 'draft_review') return 'Review Draft';
  if (review.kind === 'child_selection') return 'Select Children';
  if (review.kind === 'proposal_selection') return 'Choose Direction';
  if (review.kind === 'idea_selection') return 'Choose Themes';
  return 'Review Required';
}

function ReviewActionPanel({
  review,
  busy,
  onAccept,
  onReject,
}: {
  review: RunReviewItem;
  busy: boolean;
  onAccept: (decision: Record<string, unknown>) => void;
  onReject: () => void;
}) {
  const [intro, setIntro] = useState(payloadString(review.payload, 'introduction'));
  const [description, setDescription] = useState(payloadString(review.payload, 'description'));
  const children = payloadChildren(review.payload);
  const [selectedChildTitles, setSelectedChildTitles] = useState(() => new Set(children.map((child) => child.title)));
  const proposals = payloadProposals(review.payload);
  const suggestedIndex = typeof review.payload.suggestedIndex === 'number' ? review.payload.suggestedIndex : 0;
  const [selectedProposalIndex, setSelectedProposalIndex] = useState(Math.min(Math.max(suggestedIndex, 0), Math.max(0, proposals.length - 1)));
  const ideas = payloadIdeas(review.payload);
  const [editableProposals, setEditableProposals] = useState(proposals);
  const [editableIdeas, setEditableIdeas] = useState(ideas);
  const [selectedIdeaIds, setSelectedIdeaIds] = useState(() => new Set(ideas.map((idea) => idea.id)));

  const acceptDecision = () => {
    if (review.kind === 'intro_review') {
      onAccept({ introduction: intro });
      return;
    }
    if (review.kind === 'draft_review') {
      onAccept({ description });
      return;
    }
    if (review.kind === 'child_selection') {
      onAccept({ children: children.filter((child) => selectedChildTitles.has(child.title)) });
      return;
    }
    if (review.kind === 'proposal_selection') {
      onAccept({ selectedIndex: selectedProposalIndex, proposal: editableProposals[selectedProposalIndex] });
      return;
    }
    if (review.kind === 'idea_selection') {
      onAccept({ ideas: editableIdeas.filter((idea) => selectedIdeaIds.has(idea.id)) });
      return;
    }
    onAccept({});
  };

  const title = payloadString(review.payload, 'title');

  return (
    <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Action Required</p>
          <h3 className="text-sm font-semibold text-gray-900 mt-1">{reviewTitle(review)}</h3>
          <p className="text-xs text-amber-700 mt-1">
            {review.step}{title ? ` · ${title}` : ''}. Accept to continue this run, or reject to stop this step.
          </p>
        </div>
        <LabelBadge label="Needs input" colorClass="bg-amber-100 text-amber-700" />
      </div>

      {review.kind === 'intro_review' && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-amber-600 mb-1">Introduction</p>
          <textarea
            value={intro}
            onChange={(event) => setIntro(event.target.value)}
            className="min-h-32 w-full resize-y rounded-md border border-amber-200 bg-white p-3 text-sm leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
      )}

      {review.kind === 'draft_review' && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-amber-600 mb-1">Description Draft</p>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-72 w-full resize-y rounded-md border border-amber-200 bg-white p-3 text-sm leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
      )}

      {review.kind === 'child_selection' && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-600">Proposed Children</p>
          {children.map((child) => (
            <label key={child.title} className="block rounded-md border border-amber-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedChildTitles.has(child.title)}
                  onChange={(event) => {
                    const next = new Set(selectedChildTitles);
                    if (event.target.checked) next.add(child.title);
                    else next.delete(child.title);
                    setSelectedChildTitles(next);
                  }}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-semibold text-gray-900">{child.title}</p>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{child.introduction}</p>
                </div>
              </div>
            </label>
          ))}
          {children.length === 0 && (
            <p className="rounded-md border border-amber-200 bg-white p-3 text-xs text-gray-500">No child proposals were recorded.</p>
          )}
        </div>
      )}

      {review.kind === 'proposal_selection' && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-600">Expansion Directions</p>
          {editableProposals.map((proposal, index) => (
            <label key={`${proposal.title}-${index}`} className="block rounded-md border border-amber-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`proposal-${review.id}`}
                  checked={selectedProposalIndex === index}
                  onChange={() => setSelectedProposalIndex(index)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <input
                    value={proposal.title}
                    onChange={(event) => {
                      const next = [...editableProposals];
                      next[index] = { ...next[index], title: event.target.value };
                      setEditableProposals(next);
                    }}
                    className="w-full rounded border border-gray-200 px-2 py-1 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-300"
                    placeholder={`Direction ${index + 1}`}
                  />
                  <textarea
                    value={proposal.direction}
                    onChange={(event) => {
                      const next = [...editableProposals];
                      next[index] = { ...next[index], direction: event.target.value };
                      setEditableProposals(next);
                    }}
                    className="mt-2 min-h-20 w-full resize-y rounded border border-gray-200 px-2 py-1 text-xs leading-relaxed text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                </div>
              </div>
            </label>
          ))}
          {proposals.length === 0 && (
            <p className="rounded-md border border-amber-200 bg-white p-3 text-xs text-gray-500">No expansion directions were recorded.</p>
          )}
        </div>
      )}

      {review.kind === 'idea_selection' && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-600">Expansion Themes</p>
          {editableIdeas.map((idea, index) => (
            <label key={idea.id} className="block rounded-md border border-amber-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedIdeaIds.has(idea.id)}
                  onChange={(event) => {
                    const next = new Set(selectedIdeaIds);
                    if (event.target.checked) next.add(idea.id);
                    else next.delete(idea.id);
                    setSelectedIdeaIds(next);
                  }}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <input
                    value={idea.theme}
                    onChange={(event) => {
                      const next = [...editableIdeas];
                      next[index] = { ...next[index], theme: event.target.value };
                      setEditableIdeas(next);
                    }}
                    className="w-full rounded border border-gray-200 px-2 py-1 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-300"
                    placeholder="Theme"
                  />
                  <textarea
                    value={idea.detail}
                    onChange={(event) => {
                      const next = [...editableIdeas];
                      next[index] = { ...next[index], detail: event.target.value };
                      setEditableIdeas(next);
                    }}
                    className="mt-2 min-h-20 w-full resize-y rounded border border-gray-200 px-2 py-1 text-xs leading-relaxed text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                </div>
              </div>
            </label>
          ))}
          {ideas.length === 0 && (
            <p className="rounded-md border border-amber-200 bg-white p-3 text-xs text-gray-500">No themes were recorded.</p>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2 border-t border-amber-200 pt-3">
        <button
          onClick={acceptDecision}
          disabled={busy}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? 'Continuing...' : 'Accept & Continue'}
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function isRunActive(run: Run | RunWithEvents): boolean {
  return run.status === 'running' || run.status === 'pending' || run.status === 'needs_input';
}

function isRunSavedHistory(run: Run | RunWithEvents): boolean {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'stopped';
}

function runDurationMs(run: Run | RunWithEvents): number {
  const end = isRunActive(run) ? Date.now() : run.updatedAt;
  return Math.max(0, end - run.createdAt);
}

function startStepFromPipelineType(pipelineType: RunConfig['pipelineType']): PipelineStartStep {
  if (pipelineType === 'propose_children') return 'branching';
  if (pipelineType === 'forge_expand' || pipelineType === 'expand_description') return 'expansion';
  return 'inception';
}

function runStartStep(run: RunWithEvents): PipelineStartStep {
  if (run.config.startStep) return run.config.startStep;
  if (run.config.pipelineType) return startStepFromPipelineType(run.config.pipelineType);
  const oldestEvent = [...run.events].reverse()[0];
  if (oldestEvent?.step === 'Expansion') return 'expansion';
  if (oldestEvent?.step === 'Branching') return 'branching';
  return 'inception';
}

function runPipelineSteps(run: RunWithEvents): PipelineStartStep[] {
  const order: PipelineStartStep[] = ['inception', 'expansion', 'branching'];
  const start = runStartStep(run);
  const continuation = run.config.forgeContinuationMode ?? 'finish_document';
  if (continuation === 'one_step') return [start];
  return order.slice(order.indexOf(start));
}

function agentStageDefinitions(run: RunWithEvents): Array<Omit<AgentStage, 'status' | 'call' | 'detail'>> {
  const stages: Array<Omit<AgentStage, 'status' | 'call' | 'detail'>> = [];
  const add = (step: PipelineStartStep, group: string, agentType: string) => {
    stages.push({
      key: `${step}:${group}:${agentType}:${stages.length}`,
      step,
      group,
      agentType,
      label: AGENT_LABELS[agentType] ?? agentType,
    });
  };

  for (const step of runPipelineSteps(run)) {
    if (step === 'inception') {
      add(step, 'Context', 'context_assembly');
      add(step, 'Introduction', 'lorekeeper');
      if (run.config.forgeUseGroundingCheck) add(step, 'Grounding', 'grounding_check');
    }
    if (step === 'expansion') {
      add(step, 'Context', 'context_assembly');
      add(step, 'Direction', 'muse');
      add(step, 'Direction', 'curator');
      if (run.config.forgeUseOracle) add(step, 'Ideation', 'oracle');
      add(step, 'Drafting', 'researcher');
      add(step, 'Drafting', 'scribe');
      if (run.config.forgeUseContinuityEditor) add(step, 'Continuity', 'continuity_editor');
    }
    if (step === 'branching') {
      add(step, 'Context', 'context_assembly');
      add(step, 'Children', 'cartographer');
      if (run.config.forgeUseDedupCheck) add(step, 'Children', 'dedup_check');
    }
  }

  return stages;
}

function pipelineStepForCall(call: RunAgentCall): PipelineStartStep | null {
  if (call.pipelineType === 'summarize') return 'inception';
  if (call.pipelineType === 'propose' || call.pipelineType === 'expand' || call.pipelineType === 'propose_ideas') return 'expansion';
  if (call.pipelineType === 'propose_children') return 'branching';
  return null;
}

function buildAgentStages(run: RunWithEvents, articleId: string | null): AgentStage[] {
  const callsByAgent = new Map<string, RunAgentCall[]>();
  const rootArticleId = run.config.rootArticleId ?? run.articleIds[0] ?? null;
  const articleCalls = (run.agentCalls ?? []).filter((call) => (
    articleId
      ? call.articleId === articleId || (call.articleId === null && articleId === rootArticleId)
      : true
  ));
  const articleReviews = (run.reviewItems ?? []).filter((review) => (
    articleId
      ? review.articleId === articleId || (review.articleId === null && articleId === rootArticleId)
      : true
  ));
  for (const call of articleCalls) {
    if (!callsByAgent.has(call.agentType)) callsByAgent.set(call.agentType, []);
    callsByAgent.get(call.agentType)!.push(call);
  }
  const calledSteps = new Set(articleCalls.map(pipelineStepForCall).filter(Boolean));
  const latestReviewByKind = new Map<string, RunReviewItem>();
  for (const review of articleReviews) {
    latestReviewByKind.set(review.kind, review);
  }

  const stages = agentStageDefinitions(run).map<AgentStage>((stage) => {
    if (stage.agentType === 'context_assembly') {
      return {
        ...stage,
        status: calledSteps.has(stage.step) ? 'completed' : 'pending',
        detail: calledSteps.has(stage.step) ? 'Context package prepared.' : undefined,
      };
    }
    const calls = callsByAgent.get(stage.agentType) ?? [];
    const failedCall = calls.find((call) => call.status === 'error' || call.status === 'rejected');
    const latestCall = calls[calls.length - 1];
    if (failedCall) {
      return {
        ...stage,
        status: 'failed',
        call: failedCall,
        detail: failedCall.errorMessage ?? `${stage.label} failed.`,
      };
    }
    if (latestCall?.status === 'success') {
      return {
        ...stage,
        status: 'completed',
        call: latestCall,
        detail: `${stage.label} completed.`,
      };
    }
    if (stage.agentType === 'curator') {
      const review = latestReviewByKind.get('proposal_selection');
      if (review?.status === 'accepted') {
        return {
          ...stage,
          status: 'completed',
          detail: 'Direction selected by user.',
        };
      }
      if (review?.status === 'rejected') {
        return {
          ...stage,
          status: 'failed',
          detail: 'Direction rejected by user.',
        };
      }
    }
    if (stage.agentType === 'oracle') {
      const review = latestReviewByKind.get('idea_selection');
      if (review?.status === 'accepted') {
        return {
          ...stage,
          status: 'completed',
          detail: 'Themes selected by user.',
        };
      }
      if (review?.status === 'rejected') {
        return {
          ...stage,
          status: 'skipped',
          detail: 'Themes skipped by user.',
        };
      }
    }
    return {
      ...stage,
      status: 'pending',
    };
  });

  let hasFailure = stages.some((stage) => stage.status === 'failed');
  const failedStep = run.events.find((event) => !event.ok)?.step.toLowerCase() as PipelineStartStep | undefined;
  if (!hasFailure && failedStep) {
    const failedStage = stages.find((stage) => stage.step === failedStep && stage.status === 'pending');
    if (failedStage) {
      failedStage.status = 'failed';
      failedStage.detail = `${failedStage.label} did not complete before ${failedStage.step}.`;
      hasFailure = true;
    }
  }
  if (isRunActive(run) && !hasFailure) {
    const next = stages.find((stage) => stage.status === 'pending');
    if (next) next.status = 'running';
  }
  return stages;
}

function stageStatusClass(status: AgentStageStatus): string {
  if (status === 'completed') return 'bg-green-100 text-green-700';
  if (status === 'failed') return 'bg-red-100 text-red-700';
  if (status === 'running') return 'bg-blue-100 text-blue-700';
  if (status === 'skipped') return 'bg-gray-100 text-gray-500';
  return 'bg-gray-100 text-gray-500';
}

function stageStatusLabel(status: AgentStageStatus): string {
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'running') return 'Running';
  if (status === 'skipped') return 'Skipped';
  return 'To come';
}

function stageStatusDotClass(status: AgentStageStatus): string {
  if (status === 'completed') return 'bg-green-500';
  if (status === 'failed') return 'bg-red-500';
  if (status === 'running') return 'bg-amber-400';
  if (status === 'skipped') return 'bg-gray-300';
  return 'bg-gray-300';
}

function stageTaskLabel(stage: AgentStage): string {
  return AGENT_TASKS[stage.agentType] ?? stage.group;
}

function stageStatusSentence(stage: AgentStage): string {
  if (stage.status === 'running') return `${stage.label} is working on ${stageTaskLabel(stage).toLowerCase()}.`;
  if (stage.status === 'pending') return `${stage.label} is queued for ${stageTaskLabel(stage).toLowerCase()}.`;
  if (stage.status === 'failed') return stage.detail ?? `${stage.label} found an issue.`;
  if (stage.status === 'completed') {
    if (stage.agentType === 'context_assembly') return 'Context is ready for this article.';
    return stage.detail ?? `${stage.label} completed ${stageTaskLabel(stage).toLowerCase()}.`;
  }
  return `${stage.label} was skipped.`;
}

function stageDiagnosticNote(stage: AgentStage): string {
  return stage.detail
    ?? stage.call?.errorMessage
    ?? (stage.agentType === 'context_assembly'
      ? 'The system assembled world and article context before the LLM agent stage.'
      : stage.status === 'pending'
        ? 'This stage has not run for the selected article yet.'
        : stage.status === 'running'
          ? 'This is the next expected MAS stage for the selected article.'
          : 'No additional details were recorded for this stage.');
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function statusClass(status: Run['status']): string {
  if (status === 'completed') return 'bg-green-100 text-green-700';
  if (status === 'failed' || status === 'stopped') return 'bg-red-100 text-red-700';
  if (status === 'paused' || status === 'needs_input') return 'bg-amber-100 text-amber-700';
  if (status === 'running' || status === 'pending') return 'bg-blue-100 text-blue-700';
  return 'bg-gray-100 text-gray-600';
}

function shortRunId(id: string): string {
  return id.slice(0, 8);
}

function runDisplayName(run: Run | RunWithEvents): string {
  return `Run ${shortRunId(run.id)}`;
}

export default function ExpandPage() {
  const { wid } = useParams<{ wid: string }>();
  const [searchParams] = useSearchParams();
  const {
    treeNodes,
    agentPhase,
    agentParams,
    agentEstimatedTokens,
    agentError,
    currentArticleDetail,
    forgeRunning,
    forgePaused,
    selectArticle,
    openAgentPanel,
    closeAgentPanel,
    setAgentParams,
    startForge,
  } = useStore();

  const flatNodes = useMemo(() => flattenTree(treeNodes), [treeNodes]);
  const nodeTitleById = useMemo(() => new Map(flatNodes.map((node) => [node.id, node.title])), [flatNodes]);
  const [startingNodeId, setStartingNodeId] = useState('');
  const [startStep, setStartStep] = useState<PipelineStartStep>('inception');
  const [continuationMode, setContinuationMode] = useState<ContinuationMode>('finish_document');
  const [validationLevel, setValidationLevel] = useState<ValidationLevel>('manual');
  const [inceptionExistingMode, setInceptionExistingMode] = useState<ExistingContentMode>('improve');
  const [expansionExistingMode, setExpansionExistingMode] = useState<ExistingContentMode>('improve');
  const [branchingExistingMode, setBranchingExistingMode] = useState<BranchingExistingMode>('append_deduped');
  const [guidance, setGuidance] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunWithEvents | null>(null);
  const [selectedRunArticleId, setSelectedRunArticleId] = useState<string | null>(null);
  const [selectedRunStageKey, setSelectedRunStageKey] = useState<string | null>(null);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  const [llmTraces, setLlmTraces] = useState<RunLlmTrace[]>([]);
  const [llmTracesLoading, setLlmTracesLoading] = useState(false);
  const [llmTraceError, setLlmTraceError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [runActionBusy, setRunActionBusy] = useState(false);
  const [clearingRuns, setClearingRuns] = useState(false);
  const [autoSelectRuns, setAutoSelectRuns] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const startArticleId = searchParams.get('start');

  useEffect(() => {
    if (!startingNodeId && flatNodes[0]) setStartingNodeId(flatNodes[0].id);
  }, [flatNodes, startingNodeId]);

  useEffect(() => {
    if (!startArticleId) return;
    if (flatNodes.some((node) => node.id === startArticleId)) {
      setStartingNodeId(startArticleId);
    }
  }, [flatNodes, startArticleId]);

  useEffect(() => {
    if (!wid || !startingNodeId) return;
    selectArticle(wid, startingNodeId).catch(console.error);
  }, [wid, startingNodeId, selectArticle]);

  const loadRuns = async (selectLatest = false) => {
    if (!wid) return;
    const list = await api.runs.list(wid);
    setRuns(list);
    if (selectLatest && list[0]) {
      setAutoSelectRuns(true);
      setSelectedRunId(list[0].id);
      return;
    }
    if (!selectedRunId && autoSelectRuns && list[0]) {
      const active = list.find((run) => run.status === 'running' || run.status === 'pending' || run.status === 'needs_input' || run.status === 'paused');
      setSelectedRunId((active ?? list[0]).id);
    }
  };

  useEffect(() => {
    loadRuns().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid]);

  useEffect(() => {
    if (!wid || !selectedRunId) {
      setSelectedRun(null);
      setSelectedRunArticleId(null);
      setSelectedRunStageKey(null);
      setLlmTraces([]);
      setSelectedTraceId(null);
      setLlmTraceError(null);
      return;
    }
    let cancelled = false;
    setSelectedRun(null);
    setSelectedRunArticleId(null);
    setSelectedRunStageKey(null);
    setLlmTraces([]);
    setSelectedTraceId(null);
    setLlmTraceError(null);
    setSelectedRunLoading(true);
    api.runs.get(wid, selectedRunId)
      .then((run) => {
        if (!cancelled) setSelectedRun(run);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setSelectedRunLoading(false);
      });
    return () => { cancelled = true; };
  }, [wid, selectedRunId]);

  useEffect(() => {
    if (!wid) return;
    const hasActive = runs.some((run) => run.status === 'running' || run.status === 'pending' || run.status === 'needs_input');
    if (!hasActive && !forgeRunning) return;
    const timer = window.setInterval(() => {
      loadRuns().catch(console.error);
      if (selectedRunId) {
        api.runs.get(wid, selectedRunId)
          .then((run) => {
            if (run.id === selectedRunId) setSelectedRun(run);
          })
          .catch(console.error);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, runs, selectedRunId, forgeRunning]);

  const selectedNode = flatNodes.find((node) => node.id === startingNodeId) ?? flatNodes[0];
  const isForgeRun = true;
  const isRecursive = continuationMode === 'recursive';
  const pipelineType: PipelineType =
    startStep === 'inception' ? 'summarize' :
    startStep === 'branching' ? 'propose_children' :
    'forge_expand';
  const introWords = countWords(currentArticleDetail?.introduction ?? '');
  const descWords = countWords(currentArticleDetail?.version?.description ?? '');
  const startStepAvailability: Record<PipelineStartStep, { ok: boolean; reason: string }> = {
    inception: { ok: true, reason: '' },
    expansion: {
      ok: introWords >= 15,
      reason: `Needs at least 15 introduction words. Current: ${introWords}.`,
    },
    branching: {
      ok: introWords >= 15 && descWords >= 40,
      reason: introWords < 15
        ? `Needs at least 15 introduction words. Current: ${introWords}.`
        : `Needs at least 40 description words. Current: ${descWords}.`,
    },
  };
  const pipelineOrder: PipelineStartStep[] = ['inception', 'expansion', 'branching'];
  const selectedSteps = continuationMode === 'one_step'
    ? [startStep]
    : pipelineOrder.slice(pipelineOrder.indexOf(startStep));

  const activeRun = runs.find((run) => run.status === 'running' || run.status === 'pending' || run.status === 'needs_input' || run.status === 'paused') ?? null;
  const oracleEnabled = isForgeRun && validationLevel !== 'manual';
  const mandatoryQualityChecks = isForgeRun ? 3 : 0;
  const qualityChecks = mandatoryQualityChecks + (oracleEnabled ? 1 : 0);
  const runDepth = isRecursive ? agentParams.forgeMaxDepth : 1;
  const effectiveScopeArticles = isRecursive
    ? estimateRecursiveScope(agentParams.forgeMaxChildren, runDepth)
    : 1;
  const callsPerDocument = selectedSteps.reduce((total, step) => (
    total + (step === 'expansion' ? 3 : 1)
  ), 0);
  const estimatedCalls = Math.max(1, effectiveScopeArticles * (callsPerDocument + qualityChecks));
  const estimatedTokensK = Math.max(1, Math.round(estimatedCalls * (agentParams.contextDepth === 'deep' ? 1.6 : agentParams.contextDepth === 'mid' ? 1.1 : 0.7)));
  const estimatedDocuments = effectiveScopeArticles;
  const estimatedQueueItems = effectiveScopeArticles;

  const handleStart = async () => {
    if (!wid || !selectedNode) return;

    await selectArticle(wid, selectedNode.id);
    openAgentPanel(selectedNode.id, selectedNode.title, 'spark', pipelineType);
    setAgentParams({
      forgeEnabled: true,
      autoSelect: validationLevel !== 'manual',
      autoChain: validationLevel === 'autopilot',
      userSpec: guidance.trim(),
      forgeMaxDepth: runDepth,
      forgeMaxChildren: agentParams.forgeMaxChildren,
      forgeMode: agentParams.forgeMode,
      branchingMode: agentParams.branchingMode,
      contextDepth: agentParams.contextDepth,
      includeCurrentContent: startStep === 'inception' || agentParams.includeCurrentContent,
      forgeUseOracle: oracleEnabled,
      forgeUseContinuityEditor: isForgeRun,
      forgeUseGroundingCheck: isForgeRun,
      forgeUseDedupCheck: isForgeRun,
      forgeContinuationMode: continuationMode,
      runValidationLevel: validationLevel,
      forgeInceptionExistingMode: inceptionExistingMode,
      forgeExpansionExistingMode: expansionExistingMode,
      forgeBranchingExistingMode: branchingExistingMode,
    });

    await startForge(wid);
    window.setTimeout(() => loadRuns(true).catch(console.error), 700);
  };

  const markCustom = () => undefined;

  const runDisabled = !wid || !selectedNode || !startStepAvailability[startStep].ok || agentPhase === 'generating' || agentPhase === 'expanding' || forgeRunning;
  const canClear = forgeRunning || forgePaused || agentPhase === 'done' || agentPhase === 'error' || agentPhase === 'forge_done';

  const getRunStartTitle = (run: Run | RunWithEvents | null | undefined): string => {
    const articleId = run?.articleIds[0];
    if (!articleId) return 'Unknown article';
    return nodeTitleById.get(articleId) ?? articleId;
  };

  const getArticleTitle = (articleId: string | null | undefined, fallback?: string): string => {
    if (!articleId) return fallback ?? 'Unknown article';
    return nodeTitleById.get(articleId) ?? fallback ?? articleId;
  };

  const getCurrentArticleId = (run: RunWithEvents): string | null => {
    const latestArticleCall = [...(run.agentCalls ?? [])].reverse().find((call) => call.articleId);
    if (latestArticleCall?.articleId) return latestArticleCall.articleId;
    return run.config.rootArticleId ?? run.articleIds[0] ?? null;
  };

  const getRunArticleSummary = (run: RunWithEvents) => {
    const currentArticleId = getCurrentArticleId(run);
    const currentTitle = getArticleTitle(currentArticleId, run.events[0]?.title ?? getRunStartTitle(run));
    const visitedIds = uniqueValues((run.agentCalls ?? []).map((call) => call.articleId).filter((id): id is string => Boolean(id)));
    const knownArticleIds = visitedIds.length > 0
      ? visitedIds
      : (run.itemsTotal > 1 && currentArticleId ? [currentArticleId] : []);
    const currentOrSelectedId = selectedRunArticleId ?? currentArticleId;
    const classifyArticle = (articleId: string): 'finished' | 'to_do' => {
      const stages = buildAgentStages(run, articleId);
      if (stages.length > 0 && stages.every((stage) => stage.status === 'completed')) return 'finished';
      return 'to_do';
    };
    const finishedArticles = knownArticleIds
      .filter((id) => id !== currentArticleId && classifyArticle(id) === 'finished')
      .map((id) => ({ id, title: getArticleTitle(id) }));
    const toDoArticles = knownArticleIds
      .filter((id) => id !== currentArticleId && classifyArticle(id) !== 'finished')
      .map((id) => ({ id, title: getArticleTitle(id) }));
    const unknownRemainingCount = Math.max(
      0,
      run.itemsTotal - run.itemsCompleted - (isRunActive(run) ? 1 : 0) - toDoArticles.length,
    );

    return {
      currentArticleId,
      currentOrSelectedId,
      currentTitle,
      selectedTitle: getArticleTitle(currentOrSelectedId, currentTitle),
      finishedArticles,
      toDoArticles,
      unknownRemainingCount,
      hasArticleScopedCalls: visitedIds.length > 0,
    };
  };

  const selectedRunForDetails = selectedRun?.id === selectedRunId ? selectedRun : null;
  const selectedRunFailedEvent = selectedRunForDetails?.events.find((event) => !event.ok);
  const selectedPendingReview = selectedRunForDetails?.reviewItems.find((item) => item.status === 'pending') ?? null;
  const selectedRunCanResume = selectedRunForDetails?.status === 'paused';
  const selectedRunArticleSummary = selectedRunForDetails ? getRunArticleSummary(selectedRunForDetails) : null;
  const selectedRunAgentStages = selectedRunForDetails
    ? buildAgentStages(selectedRunForDetails, selectedRunArticleSummary?.currentOrSelectedId ?? null)
    : [];
  const selectedRunStage = selectedRunAgentStages.find((stage) => stage.key === selectedRunStageKey) ?? null;
  const visibleLlmTraces = selectedRunStage
    ? llmTraces.filter((trace) => (
      trace.agentType === selectedRunStage.agentType &&
      (!selectedRunArticleSummary?.currentOrSelectedId || trace.articleId === selectedRunArticleSummary.currentOrSelectedId)
    ))
    : llmTraces;
  const selectedTrace = visibleLlmTraces.find((trace) => trace.id === selectedTraceId) ?? visibleLlmTraces[0] ?? null;

  const handleLoadLlmTraces = async () => {
    if (!wid || !selectedRunForDetails || llmTracesLoading) return;
    setLlmTracesLoading(true);
    setLlmTraceError(null);
    try {
      const traces = await api.runs.llmTraces(wid, selectedRunForDetails.id);
      setLlmTraces(traces);
      setSelectedTraceId(traces[0]?.id ?? null);
    } catch (err) {
      setLlmTraceError(err instanceof Error ? err.message : 'Unable to load LLM traces.');
      setLlmTraces([]);
      setSelectedTraceId(null);
    } finally {
      setLlmTracesLoading(false);
    }
  };

  const handleClearRunHistory = async () => {
    if (!wid || clearingRuns) return;
    setClearingRuns(true);
    try {
      await api.runs.clear(wid);
      const selectedWasDeleted = runs.some((run) => run.id === selectedRunId && isRunSavedHistory(run));
      const refreshed = await api.runs.list(wid);
      setRuns(refreshed);
      setAutoSelectRuns(false);
      if (selectedWasDeleted) {
        setSelectedRunId(null);
        setSelectedRun(null);
      }
    } finally {
      setClearingRuns(false);
    }
  };

  const handleResumeSelectedRun = async () => {
    if (!wid || !selectedRunForDetails || runActionBusy) return;
    setRunActionBusy(true);
    try {
      await api.runs.resume(wid, selectedRunForDetails.id);
      await loadRuns();
      const refreshed = await api.runs.get(wid, selectedRunForDetails.id);
      setSelectedRun(refreshed);
    } finally {
      setRunActionBusy(false);
    }
  };

  const handleReviewDecision = async (review: RunReviewItem, action: 'accept' | 'reject', decision?: Record<string, unknown>) => {
    if (!wid || !selectedRunForDetails || runActionBusy) return;
    setRunActionBusy(true);
    try {
      await api.runs.decideReview(wid, selectedRunForDetails.id, review.id, { action, decision });
      await loadRuns();
      window.setTimeout(() => {
        if (!wid || !selectedRunForDetails) return;
        api.runs.get(wid, selectedRunForDetails.id)
          .then(setSelectedRun)
          .catch(console.error);
      }, 700);
    } finally {
      setRunActionBusy(false);
    }
  };

  const handleReuseSelectedRun = async () => {
    if (!wid || !selectedRunForDetails) return;
    const config = selectedRunForDetails.config;
    const articleId = config.rootArticleId ?? selectedRunForDetails.articleIds[0];
    if (articleId) {
      setStartingNodeId(articleId);
      await selectArticle(wid, articleId).catch(console.error);
    }

    const reusedStartStep = config.startStep ?? startStepFromPipelineType(config.pipelineType);
    const reusedContinuation = config.forgeContinuationMode ?? 'finish_document';
    const reusedValidation = config.validationLevel ?? (
      config.commitPolicy === 'auto_commit' ? 'autopilot' : 'manual'
    );

    setStartStep(reusedStartStep);
    setContinuationMode(reusedContinuation);
    setValidationLevel(reusedValidation);
    setInceptionExistingMode(config.forgeInceptionExistingMode ?? 'improve');
    setExpansionExistingMode(config.forgeExpansionExistingMode ?? 'improve');
    setBranchingExistingMode(config.forgeBranchingExistingMode ?? 'append_deduped');
    setGuidance('');
    setAgentParams({
      contextDepth: config.contextDepth ?? agentParams.contextDepth,
      branchingMode: config.branchingMode ?? agentParams.branchingMode,
      forgeMode: config.forgeMode ?? agentParams.forgeMode,
      forgeMaxDepth: config.forgeMaxDepth ?? agentParams.forgeMaxDepth,
      forgeMaxChildren: config.forgeMaxChildren ?? agentParams.forgeMaxChildren,
      forgeUseOracle: config.forgeUseOracle ?? agentParams.forgeUseOracle,
      forgeUseContinuityEditor: config.forgeUseContinuityEditor ?? agentParams.forgeUseContinuityEditor,
      forgeUseGroundingCheck: config.forgeUseGroundingCheck ?? agentParams.forgeUseGroundingCheck,
      forgeUseDedupCheck: config.forgeUseDedupCheck ?? agentParams.forgeUseDedupCheck,
      forgeContinuationMode: reusedContinuation,
      runValidationLevel: reusedValidation,
      forgeInceptionExistingMode: config.forgeInceptionExistingMode ?? 'improve',
      forgeExpansionExistingMode: config.forgeExpansionExistingMode ?? 'improve',
      forgeBranchingExistingMode: config.forgeBranchingExistingMode ?? 'append_deduped',
    });
    setSettingsOpen(true);
  };

  return (
    <WorkspaceLayout
      rightOpen={settingsOpen}
      left={
        <>
          <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold text-gray-900">Runs</h1>
            </div>
            <button
              onClick={handleClearRunHistory}
              disabled={clearingRuns || !runs.some(isRunSavedHistory)}
              className="text-[11px] text-gray-400 hover:text-gray-700 mt-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {clearingRuns ? 'Clearing...' : 'Clear'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {runs.length === 0 ? (
              <p className="text-xs text-gray-400">No generation runs yet.</p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => {
                      if (selectedRunId === run.id) {
                        setAutoSelectRuns(false);
                        setSelectedRunId(null);
                        setSelectedRun(null);
                      } else {
                        setAutoSelectRuns(true);
                        setSelectedRunId(run.id);
                      }
                    }}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selectedRunId === run.id
                        ? 'border-purple-300 bg-purple-50'
                        : run.status === 'failed'
                          ? 'border-red-200 bg-red-50 hover:bg-red-100/50'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <LabelBadge label={RUN_STATUS_LABELS[run.status]} colorClass={statusClass(run.status)} />
                      <span className="text-[10px] text-gray-400">{formatDuration(runDurationMs(run))}</span>
                    </div>
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-gray-900">{runDisplayName(run)}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate" title={run.articleIds[0] ?? run.id}>
                        Start: {getRunStartTitle(run)}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1">Started {formatTime(run.createdAt)}</p>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Progress</p>
                        <p className="font-semibold text-gray-700">{run.itemsCompleted} / {run.itemsTotal}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">Tokens</p>
                        <p className="font-semibold text-gray-700">~{run.budgetUsed.toLocaleString()}</p>
                      </div>
                    </div>
                    {run.errorMessage && (
                      <p className="text-xs text-red-600 mt-1 line-clamp-2">{run.errorMessage}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      }
      center={
        <>
          <div className="max-w-6xl mx-auto py-8 px-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">Selected Run</p>
                <h2 className="text-2xl font-bold text-gray-900 mt-1">
                  {selectedRunForDetails ? runDisplayName(selectedRunForDetails) : 'No run selected'}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {activeRun && selectedRunId === activeRun.id
                    ? `${RUN_STATUS_LABELS[activeRun.status]} · ${activeRun.itemsCompleted} / ${activeRun.itemsTotal} items · started ${formatTime(activeRun.createdAt)} · runtime ${formatDuration(runDurationMs(activeRun))}`
                    : selectedRunForDetails
                      ? `${RUN_STATUS_LABELS[selectedRunForDetails.status]} · started ${formatTime(selectedRunForDetails.createdAt)} · runtime ${formatDuration(runDurationMs(selectedRunForDetails))}`
                      : 'Select a run in the inbox, or start a new one from the settings panel.'}
                </p>
              </div>
              {!settingsOpen && (
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <PanelRightOpen size={14} />
                  Show Settings
                </button>
              )}
            </div>

            <section className="border border-gray-200 bg-white rounded-xl overflow-hidden min-h-[520px]">
              {selectedRunLoading ? (
                <div className="p-6 text-sm text-gray-400">Loading selected run...</div>
              ) : !selectedRunForDetails ? (
                <div className="p-6">
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6">
                    <p className="text-sm font-semibold text-gray-900">No run selected</p>
                    <p className="text-sm text-gray-500 mt-1">
                      The latest active run is selected automatically when one exists. Older runs can be opened from the inbox.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{runDisplayName(selectedRunForDetails)}</h3>
                      <LabelBadge label={RUN_STATUS_LABELS[selectedRunForDetails.status]} colorClass={statusClass(selectedRunForDetails.status)} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      ID: {selectedRunForDetails.id} · created {formatTime(selectedRunForDetails.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={handleReuseSelectedRun}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      <RotateCcw size={13} />
                      Reuse Parameters
                    </button>
                    {selectedRunCanResume && (
                      <button
                        onClick={handleResumeSelectedRun}
                        disabled={runActionBusy}
                        className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:opacity-50"
                      >
                        {runActionBusy ? 'Resuming...' : 'Resume'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 p-4 border-b border-gray-100">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Start Node</p>
                    <p className="text-sm font-semibold text-gray-900 mt-1 truncate" title={selectedRunForDetails.articleIds[0] ?? selectedRunForDetails.id}>
                      {getRunStartTitle(selectedRunForDetails)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Started</p>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{formatTime(selectedRunForDetails.createdAt)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Runtime</p>
                    <p className="text-sm font-semibold text-gray-900 mt-1">{formatDuration(runDurationMs(selectedRunForDetails))}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Progress</p>
                    <p className="text-sm font-semibold text-gray-900 mt-1">
                      {selectedRunForDetails.itemsCompleted} / {selectedRunForDetails.itemsTotal}
                    </p>
                  </div>
                </div>

                {(selectedRunForDetails.errorMessage || selectedRunFailedEvent) && (
                  <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-xs font-semibold text-red-800">
                      Stopped at {selectedRunFailedEvent?.step ?? 'run failure'}
                    </p>
                    <p className="text-xs text-red-700 mt-1 leading-relaxed">
                      {selectedRunFailedEvent?.message ?? selectedRunForDetails.errorMessage}
                    </p>
                    <p className="text-xs text-red-600 mt-2">
                      Failed runs cannot be resumed directly yet. Use the same start node and rerun from the failed step or a smaller preset.
                    </p>
                  </div>
                )}

                {selectedPendingReview && (
                  <ReviewActionPanel
                    key={selectedPendingReview.id}
                    review={selectedPendingReview}
                    busy={runActionBusy}
                    onAccept={(decision) => handleReviewDecision(selectedPendingReview, 'accept', decision)}
                    onReject={() => handleReviewDecision(selectedPendingReview, 'reject')}
                  />
                )}

                <div className="p-4 border-t border-gray-100">
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Run View</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Select a known article from this run to inspect its MAS pipeline.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-800">Articles Finished</p>
                        <span className="text-[10px] text-gray-400">{selectedRunArticleSummary?.finishedArticles.length ?? 0}</span>
                      </div>
                      {selectedRunArticleSummary?.finishedArticles.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selectedRunArticleSummary.finishedArticles.slice(0, 10).map((article) => (
                            <button
                              key={article.id}
                              onClick={() => {
                                setSelectedRunArticleId(article.id);
                                setSelectedRunStageKey(null);
                              }}
                              className={`max-w-full truncate rounded-md border px-2 py-1 text-[11px] ${
                                selectedRunArticleSummary.currentOrSelectedId === article.id
                                  ? 'border-purple-300 bg-purple-50 text-purple-700'
                                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              {article.title}
                            </button>
                          ))}
                          {selectedRunArticleSummary.finishedArticles.length > 10 && (
                            <span className="rounded-md bg-white border border-gray-200 px-2 py-1 text-[11px] text-gray-400">
                              +{selectedRunArticleSummary.finishedArticles.length - 10}
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 mt-2">None.</p>
                      )}
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-800">Articles To Work On</p>
                        <span className="text-[10px] text-gray-400">
                          {(selectedRunArticleSummary?.toDoArticles.length ?? 0) + (selectedRunArticleSummary?.unknownRemainingCount ?? 0)}
                        </span>
                      </div>
                      {selectedRunArticleSummary?.toDoArticles.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selectedRunArticleSummary.toDoArticles.slice(0, 10).map((article) => (
                            <button
                              key={article.id}
                              onClick={() => {
                                setSelectedRunArticleId(article.id);
                                setSelectedRunStageKey(null);
                              }}
                              className={`max-w-full truncate rounded-md border px-2 py-1 text-[11px] ${
                                selectedRunArticleSummary.currentOrSelectedId === article.id
                                  ? 'border-purple-300 bg-purple-50 text-purple-700'
                                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              {article.title}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 mt-2">None known.</p>
                      )}
                      {selectedRunArticleSummary?.unknownRemainingCount ? (
                        <p className="text-[10px] text-gray-400 mt-2">
                          {selectedRunArticleSummary.unknownRemainingCount} queued article{selectedRunArticleSummary.unknownRemainingCount === 1 ? '' : 's'} not reached yet.
                        </p>
                      ) : null}
                      {selectedRunArticleSummary && !selectedRunArticleSummary.hasArticleScopedCalls && (
                        <p className="text-[10px] text-amber-600 mt-2">
                          Older run: article-specific agent calls are best-effort.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {selectedRunArticleSummary?.currentOrSelectedId === selectedRunArticleSummary?.currentArticleId
                            ? (isRunActive(selectedRunForDetails) ? 'Current Article MAS' : 'Last Article MAS')
                            : 'Selected Article MAS'}
                        </p>
                        <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">
                          {selectedRunArticleSummary?.selectedTitle ?? getRunStartTitle(selectedRunForDetails)}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {selectedRunAgentStages.filter((stage) => stage.status === 'completed').length} / {selectedRunAgentStages.length} stages completed
                        </p>
                      </div>
                      {selectedRunArticleSummary?.currentArticleId && selectedRunArticleSummary.currentOrSelectedId !== selectedRunArticleSummary.currentArticleId && (
                        <button
                          onClick={() => {
                            setSelectedRunArticleId(null);
                            setSelectedRunStageKey(null);
                          }}
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50"
                        >
                          Show Current
                        </button>
                      )}
                    </div>

                    {selectedRunAgentStages.length === 0 ? (
                      <p className="text-xs text-gray-400">No pipeline plan is available for this article.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {(['inception', 'expansion', 'branching'] as PipelineStartStep[]).map((step) => {
                          const stages = selectedRunAgentStages.filter((stage) => stage.step === step);
                          if (stages.length === 0) return null;
                          return (
                            <div key={step} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                              <p className="text-xs font-semibold text-gray-800 capitalize mb-2">{step}</p>
                              <div className="space-y-2">
                                {stages.map((stage) => {
                                  return (
                                    <button
                                      key={stage.key}
                                      onClick={() => setSelectedRunStageKey(selectedRunStageKey === stage.key ? null : stage.key)}
                                      className={`w-full rounded-md border p-2 text-left transition-colors ${
                                        selectedRunStageKey === stage.key
                                          ? 'border-purple-300 bg-purple-50'
                                          : 'border-gray-200 bg-white hover:bg-gray-50'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <p className="text-xs font-semibold text-gray-800 truncate">{stage.label}</p>
                                          <span className="text-[10px] text-gray-300">-</span>
                                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 truncate">{stageTaskLabel(stage)}</p>
                                        </div>
                                        <span
                                          aria-label={stageStatusLabel(stage.status)}
                                          className={`h-2.5 w-2.5 rounded-full shrink-0 ${stageStatusDotClass(stage.status)}`}
                                        />
                                      </div>
                                      <p className={`text-xs mt-2 leading-relaxed ${
                                        stage.status === 'failed' ? 'text-red-700' :
                                        stage.status === 'running' ? 'text-amber-700' :
                                        'text-gray-500'
                                      }`}>
                                        {stageStatusSentence(stage)}
                                      </p>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-4 border-t border-gray-100 pt-4">
                      {!selectedRunStage ? (
                        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4">
                          <p className="text-xs font-semibold text-gray-700">Stage Details</p>
                          <p className="text-xs text-gray-400 mt-1">Click a MAS stage above to inspect its run data.</p>
                        </div>
                      ) : (
                        <div className={`rounded-lg border p-4 ${
                          selectedRunStage.status === 'failed'
                            ? 'border-red-200 bg-red-50'
                            : selectedRunStage.status === 'running'
                              ? 'border-blue-200 bg-blue-50'
                              : 'border-gray-200 bg-gray-50'
                        }`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stage Details</p>
                              <h4 className="text-sm font-semibold text-gray-900 mt-1">{selectedRunStage.label}</h4>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {selectedRunStage.step} · {stageTaskLabel(selectedRunStage)}
                              </p>
                            </div>
                            <LabelBadge
                              label={stageStatusLabel(selectedRunStage.status)}
                              colorClass={stageStatusClass(selectedRunStage.status)}
                            />
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">Task</p>
                              <p className="text-xs font-semibold text-gray-800 mt-1">{stageTaskLabel(selectedRunStage)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">Recorded</p>
                              <p className="text-xs font-semibold text-gray-800 mt-1">
                                {selectedRunStage.call ? formatTime(selectedRunStage.call.createdAt) : 'Not yet'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">Attempts</p>
                              <p className="text-xs font-semibold text-gray-800 mt-1">
                                {typeof selectedRunStage.call?.iterations === 'number' ? selectedRunStage.call.iterations : '-'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">Tokens</p>
                              <p className="text-xs font-semibold text-gray-800 mt-1">
                                {selectedRunStage.call
                                  ? ((selectedRunStage.call.tokensIn ?? 0) + (selectedRunStage.call.tokensOut ?? 0)).toLocaleString()
                                  : '-'}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">Agent Id</p>
                              <p className="text-xs font-semibold text-gray-800 mt-1">{selectedRunStage.agentType}</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">Context</p>
                              <p className="text-xs font-semibold text-gray-800 mt-1">{selectedRunForDetails.config.contextDepth ?? 'mid'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">Validation</p>
                              <p className="text-xs font-semibold text-gray-800 mt-1">{selectedRunForDetails.config.validationLevel ?? 'autopilot'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">Continue</p>
                              <p className="text-xs font-semibold text-gray-800 mt-1">{selectedRunForDetails.config.forgeContinuationMode ?? 'recursive'}</p>
                            </div>
                          </div>

                          <div className="mt-4">
                            <p className="text-[10px] uppercase tracking-wide text-gray-400">
                              {selectedRunStage.status === 'failed' ? 'What went wrong' : 'Status'}
                            </p>
                            <p className={`text-xs mt-1 leading-relaxed ${
                              selectedRunStage.status === 'failed' ? 'text-red-700' : 'text-gray-600'
                            }`}>
                              {stageDiagnosticNote(selectedRunStage)}
                            </p>
                          </div>

                          {selectedRunStage.status === 'failed' && (
                            <div className="mt-3 rounded-md border border-red-200 bg-white/70 p-3">
                              <p className="text-[10px] uppercase tracking-wide text-red-400">Useful Checks</p>
                              <p className="text-xs text-red-700 mt-1 leading-relaxed">
                                Retry with the same parameters, lower context depth, or use Manual/Assisted validation if the failed stage produced unusable output.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {DEV_LLM_TRACE_VIEWER && (
                      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Developer LLM Trace</p>
                            <p className="text-xs text-gray-500 mt-1">
                              Raw provider exchange for local debugging. Hidden unless dev tools and server tracing are enabled.
                            </p>
                          </div>
                          <button
                            onClick={handleLoadLlmTraces}
                            disabled={llmTracesLoading}
                            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <Code2 size={13} />
                            {llmTracesLoading ? 'Loading...' : 'Load Traces'}
                          </button>
                        </div>

                        {llmTraceError && (
                          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                            {llmTraceError}
                          </p>
                        )}

                        {visibleLlmTraces.length > 0 && (
                          <div className="mt-3 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-3">
                            <div className="space-y-1.5">
                              {visibleLlmTraces.map((trace) => (
                                <button
                                  key={trace.id}
                                  onClick={() => setSelectedTraceId(trace.id)}
                                  className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                                    selectedTrace?.id === trace.id
                                      ? 'border-gray-400 bg-white text-gray-900'
                                      : 'border-gray-200 bg-white/70 text-gray-600 hover:bg-white'
                                  }`}
                                >
                                  <span className="font-semibold">{trace.agentType}</span>
                                  <span className="text-gray-400"> · {trace.provider} · #{trace.iteration}</span>
                                  <span className={trace.status === 'error' ? 'block text-red-600' : 'block text-green-700'}>
                                    {trace.status} · {formatTime(trace.createdAt)}
                                  </span>
                                </button>
                              ))}
                            </div>

                            {selectedTrace && (
                              <div className="min-w-0 space-y-3">
                                {selectedTrace.errorMessage && (
                                  <div className="rounded-md border border-red-200 bg-red-50 p-2">
                                    <p className="text-[10px] uppercase tracking-wide text-red-400">Provider Error</p>
                                    <p className="text-xs text-red-700 mt-1">{selectedTrace.errorMessage}</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Input</p>
                                  <pre className="max-h-72 overflow-auto rounded-md bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100">
                                    {formatTracePayload(selectedTrace.request)}
                                  </pre>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Output</p>
                                  <pre className="max-h-72 overflow-auto rounded-md bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100">
                                    {formatTracePayload(selectedTrace.response)}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                </>
              )}
              </section>
          </div>
        </>
      }
      right={
        <>
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Settings size={15} className="text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-900">New Generation Run</h2>
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
              >
                <PanelRightClose size={13} />
                Hide
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Configure the next generation run.</p>
          </div>

          <div className="border-b border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">Estimate</p>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Docs</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">{estimatedDocuments.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Queue</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">{estimatedQueueItems.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Calls</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">~{estimatedCalls.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Tokens</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">~{estimatedTokensK}k</p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <SettingGroup title="Selected Node" defaultOpen>
                <select
                  value={selectedNode?.id ?? ''}
                  onChange={(event) => { markCustom(); setStartingNodeId(event.target.value); }}
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-200"
                >
                  {flatNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.title}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1.5">Defaults to the root node.</p>
            </SettingGroup>

            <SettingGroup title="Pipeline" defaultOpen>
              <p className="text-xs text-gray-500 mb-1">Start at</p>
              <div className="grid grid-cols-3 gap-1.5">
                {START_STEPS.map((item) => {
                  const Icon = item.icon;
                  const active = startStep === item.id;
                  const available = startStepAvailability[item.id];
                  return (
                    <button
                      key={item.id}
                      onClick={() => { if (available.ok) { markCustom(); setStartStep(item.id); } }}
                      disabled={!available.ok}
                      title={available.ok ? item.description : available.reason}
                      className={`min-h-[64px] rounded-lg border p-2 text-left transition-colors disabled:cursor-not-allowed ${
                        active
                          ? 'border-purple-400 bg-purple-50 text-purple-800'
                          : available.ok
                            ? 'border-gray-200 text-gray-700 hover:border-purple-200 hover:bg-purple-50/50'
                            : 'border-gray-100 bg-gray-50 text-gray-300'
                      }`}
                    >
                      <Icon size={14} className={active ? 'text-purple-700' : 'text-gray-400'} />
                      <p className="text-[11px] font-semibold mt-1">{item.label}</p>
                    </button>
                  );
                })}
              </div>
              {!startStepAvailability[startStep].ok && (
                <p className="text-xs text-amber-600 mt-2">{startStepAvailability[startStep].reason}</p>
              )}

              <p className="text-xs text-gray-500 mb-1 mt-3">Continue</p>
              <div className="space-y-2">
                {CONTINUE_MODES.map((mode) => {
                  const active = continuationMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => { markCustom(); setContinuationMode(mode.id); }}
                      className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                        active
                          ? 'border-purple-400 bg-purple-50'
                          : 'border-gray-200 hover:border-purple-200 hover:bg-gray-50'
                      }`}
                    >
                      <p className={`text-xs font-semibold ${active ? 'text-purple-800' : 'text-gray-800'}`}>{mode.label}</p>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{mode.description}</p>
                    </button>
                  );
                })}
              </div>
            </SettingGroup>

            <SettingGroup title="Existing Content Behavior" defaultOpen>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-gray-700">Inception</p>
                  <p className="text-xs text-gray-400 mt-0.5 mb-1">Current introduction: {introWords} words</p>
                  <select
                    value={inceptionExistingMode}
                    onChange={(event) => setInceptionExistingMode(event.target.value as ExistingContentMode)}
                    className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-200"
                  >
                    {EXISTING_CONTENT_MODES.map((mode) => (
                      <option key={mode.id} value={mode.id}>{mode.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-700">Expansion</p>
                  <p className="text-xs text-gray-400 mt-0.5 mb-1">Current description: {descWords} words</p>
                  <select
                    value={expansionExistingMode}
                    onChange={(event) => setExpansionExistingMode(event.target.value as ExistingContentMode)}
                    className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-200"
                  >
                    {EXISTING_CONTENT_MODES.map((mode) => (
                      <option key={mode.id} value={mode.id}>{mode.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-700">Branching</p>
                  <p className="text-xs text-gray-400 mt-0.5 mb-1">Existing children are never deleted by Expand.</p>
                  <select
                    value={branchingExistingMode}
                    onChange={(event) => setBranchingExistingMode(event.target.value as BranchingExistingMode)}
                    className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-200"
                  >
                    <option value="append_deduped">Add more children, avoid duplicates</option>
                    <option value="skip_if_children">Skip if children already exist</option>
                  </select>
                </div>

                <p className="text-xs text-gray-400 leading-relaxed">
                  Replace asks the MAS for a fresh result. Branching only appends new child articles; cleanup belongs in Consolidate.
                </p>
              </div>
            </SettingGroup>

            <SettingGroup title="User Validation">
              <div className="space-y-2">
                {VALIDATION_LEVELS.map((level) => {
                  const active = validationLevel === level.id;
                  return (
                    <button
                      key={level.id}
                      onClick={() => { markCustom(); setValidationLevel(level.id); }}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? 'border-purple-400 bg-purple-50'
                          : 'border-gray-200 hover:border-purple-200 hover:bg-gray-50'
                      }`}
                    >
                      <p className={`text-xs font-semibold ${active ? 'text-purple-800' : 'text-gray-800'}`}>{level.label}</p>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{level.description}</p>
                    </button>
                  );
                })}
              </div>
            </SettingGroup>

            <SettingGroup title="Context">
              <p className="text-xs text-gray-500 mb-1">Context amount</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(['shallow', 'mid', 'deep'] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => { markCustom(); setAgentParams({ contextDepth: value }); }}
                    className={`py-1.5 text-xs rounded-md border capitalize ${
                      agentParams.contextDepth === value
                        ? 'border-purple-400 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {value === 'mid' ? 'medium' : value}
                  </button>
                ))}
              </div>
            </SettingGroup>

            <SettingGroup title="Branching">
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Branching guideline</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { value: 'conceptual' as const, label: 'Conceptual' },
                      { value: 'specific' as const, label: 'Specific' },
                    ]).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => { markCustom(); setAgentParams({ branchingMode: option.value }); }}
                        className={`py-1.5 text-xs rounded-md border ${
                          agentParams.branchingMode === option.value
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={`${selectedSteps.includes('branching') ? '' : 'opacity-50'}`}>
                  <p className="text-xs text-gray-500 mb-1">Nodes to create when branching</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { value: 3, label: '3' },
                      { value: 5, label: '5' },
                      { value: 10, label: '10' },
                      { value: 0, label: 'All' },
                    ]).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => { markCustom(); setAgentParams({ forgeMaxChildren: option.value }); }}
                        disabled={!selectedSteps.includes('branching')}
                        className={`py-1.5 text-xs rounded-md border ${
                          agentParams.forgeMaxChildren === option.value
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        } disabled:cursor-not-allowed`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </SettingGroup>

            <SettingGroup title="Recursion">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-xs font-semibold text-gray-700">Recursion</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {isRecursive ? 'Enabled by Continue: Recursive.' : 'Only used when Continue is Recursive.'}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className={`${isRecursive ? '' : 'opacity-50'}`}>
                  <p className="text-xs text-gray-500 mb-1">Creation depth</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { value: 1, label: '+1' },
                      { value: 2, label: '+2' },
                      { value: 3, label: '+3' },
                      { value: 10, label: 'Non-stop' },
                    ]).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => { markCustom(); setAgentParams({ forgeMaxDepth: option.value }); }}
                        disabled={!isRecursive}
                        className={`py-1.5 text-xs rounded-md border ${
                          agentParams.forgeMaxDepth === option.value
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        } disabled:cursor-not-allowed`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {agentParams.forgeMaxDepth === 10 && (
                    <p className="text-xs text-amber-600 mt-1">Non-stop is capped at 10 levels for safety.</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1.5">
                    {depthBehaviorLabel(runDepth)}
                  </p>
                </div>

                <div className={`${isRecursive ? '' : 'opacity-50'}`}>
                  <p className="text-xs text-gray-500 mb-1">Queue order</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { value: 'breadth' as const, label: 'Breadth-first' },
                      { value: 'depth' as const, label: 'Depth-first' },
                    ]).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => { markCustom(); setAgentParams({ forgeMode: option.value }); }}
                        disabled={!isRecursive}
                        className={`py-1.5 text-xs rounded-md border ${
                          agentParams.forgeMode === option.value
                            ? 'border-amber-400 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        } disabled:cursor-not-allowed`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </SettingGroup>

            <SettingGroup title="Guidance">
              <textarea
                value={guidance}
                onChange={(event) => { markCustom(); setGuidance(event.target.value); }}
                rows={4}
                placeholder="Optional direction, constraints, themes, or exclusions for this run."
                className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-200"
              />
            </SettingGroup>

            {agentEstimatedTokens !== null && !isForgeRun && (
              <p className="text-xs text-gray-500 px-1">API estimate: ~{agentEstimatedTokens.toLocaleString()} tokens.</p>
            )}
            {agentError && (
              <p className="text-xs text-red-600 px-1">{agentError}</p>
            )}
          </div>

          <div className="border-t border-gray-100 p-4 space-y-2">
            <button
              onClick={handleStart}
              disabled={runDisabled}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={14} />
              Start Run
            </button>
            {canClear && (
              <button
                onClick={closeAgentPanel}
                className="w-full py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
              >
                Clear Workspace
              </button>
            )}
          </div>
        </>
      }
    />
  );
}
