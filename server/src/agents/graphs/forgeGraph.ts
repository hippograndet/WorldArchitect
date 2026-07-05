import { nanoid } from 'nanoid';
import { StateGraph, GraphRecursionError } from '@langchain/langgraph';
import { getDbClient } from '../../db/client.js';
import { upsertEntry } from '../../services/worldBible.js';
import { acceptDraft, batchCreateChildArticles } from '../../services/articlesService.js';
import { getRun, markRunStatus, bumpRunBudget, releaseLocks, updateRunProgress } from '../../services/runsService.js';
import { getCheckpointer } from '../checkpointer.js';
import { runSummarizeGraph } from './pipelines/summarize.js';
import { runProposeGraph } from './pipelines/propose.js';
import { runProposeIdeasGraph } from './pipelines/proposeIdeas.js';
import { runExpandGraph } from './pipelines/expand.js';
import { runProposeChildrenGraph } from './pipelines/proposeChildren.js';
import { ForgeAnnotation } from './forgeState.js';
import { contractState, forgeContract } from './masContract.js';
import type { ForgeState, ForgeQueueItem } from './forgeState.js';
import type { ContextDepth } from '../../services/archivist.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Same fatal-vs-recoverable classification forgeSlice.ts already used client-side. */
function isFatal(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate.?limit|429|authentication|unauthorized|quota/i.test(msg);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function logEvent(runId: string, step: string, title: string, ok: boolean, message?: string): Promise<void> {
  await getDbClient().run(
    `INSERT INTO run_events (id, run_id, step, title, ok, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), runId, step, title, ok ? 1 : 0, message ?? null, Date.now()],
  );
}

/**
 * Mirrors routes/agents.ts's POST /expand handler's pending_drafts write
 * exactly (same table, same shape) so acceptDraft() — which reads from
 * pending_drafts — works unchanged. Forge only ever runs the
 * 'expand_description' pipeline type (never create_child/create_root/
 * reorganize), so the draftContent shape is always the non-child branch.
 */
async function persistExpandDraft(params: {
  articleId: string;
  ownerId: string;
  description: string;
  mentions?: unknown;
}): Promise<void> {
  const exec = getDbClient();
  const draftContent = { description: params.description, mentions: params.mentions };
  const now = Date.now();
  const existing = await exec.get<{ id: string }>(
    'SELECT id FROM pending_drafts WHERE article_id = ? AND pipeline_type = ?',
    [params.articleId, 'expand_description'],
  );
  if (existing) {
    await exec.run(
      `UPDATE pending_drafts SET draft_content = ?, updated_at = ? WHERE article_id = ? AND pipeline_type = ?`,
      [JSON.stringify(draftContent), now, params.articleId, 'expand_description'],
    );
  } else {
    await exec.run(
      `INSERT INTO pending_drafts
         (id, owner_id, article_id, draft_content, pipeline_type, expansion_params, phase, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'expand_description', '{}', 'done', ?, ?)`,
      [nanoid(), params.ownerId, params.articleId, JSON.stringify(draftContent), now, now],
    );
  }
}

// ---------------------------------------------------------------------------
// Nodes — one per Forge step, cascading exactly like forgeSlice.ts's
// runForgeLoop: inception (if startStep === 'inception') falls into expansion
// (if startStep !== 'branching') falls into branching (if depth < maxDepth).
// Each node wraps its own body in try/catch so a non-fatal error only skips
// the rest of *this* item (routed to finishItem) while a fatal one ends the
// whole run — same classification/behavior as the original loop's catch block.
// ---------------------------------------------------------------------------

async function dequeueNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const run = await getRun(state.worldId, state.ownerId, state.runId);
  if (!run || run.status === 'stopped') return { signal: 'stopped' };
  if (run.status === 'paused') return { signal: 'paused' };

  // A resume after a crash mid-cascade checkpoints with currentItem still
  // set (its steps not all done yet) — continue that item instead of
  // silently dropping it and popping the next one off the queue.
  if (state.currentItem) return { signal: 'continue' };

  if (state.queue.length === 0) return { signal: 'completed' };

  const [item, ...rest] = state.queue;
  return {
    currentItem: item,
    queue: rest,
    signal: 'continue',
    lastStepError: undefined,
    inceptionIntro: undefined,
    currentItemStepsDone: [],
  };
}

async function inceptionNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (item.startStep !== 'inception' || state.currentItemStepsDone.includes('inception')) return {};

  try {
    const result = await runSummarizeGraph({ worldId: state.worldId, articleId: item.articleId, mode: 'improve' });
    await upsertEntry(getDbClient(), state.worldId, item.articleId, result.introduction);
    await bumpRunBudget(state.runId, result.tokensIn + result.tokensOut);
    await logEvent(state.runId, 'Inception', item.title, true);
    return { inceptionIntro: result.introduction, currentItemStepsDone: [...state.currentItemStepsDone, 'inception'] };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state.runId, 'Inception', item.title, false, errorMessage(err));
    return { lastStepError: { step: 'Inception', fatal, message: errorMessage(err) }, ...(fatal ? { signal: 'error' as const } : {}) };
  }
}

async function expansionNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (item.startStep === 'branching' || state.currentItemStepsDone.includes('expansion')) return {};

  try {
    const proposeResult = await runProposeGraph({
      worldId: state.worldId,
      articleId: item.articleId,
      pipelineType: 'expand_description',
      autoSelect: true,
      contextDepth: state.contextDepth,
    });
    const selectedIndex = proposeResult.autoSelectedIndex ?? 0;
    const selectedProposal = proposeResult.proposals[selectedIndex];
    await bumpRunBudget(state.runId, proposeResult.tokensIn + proposeResult.tokensOut);

    let selectedIdeas: Awaited<ReturnType<typeof runProposeIdeasGraph>>['ideas'] | undefined;
    if (state.forgeUseOracle && state.inceptionIntro?.trim() && selectedProposal) {
      try {
        const ideasResult = await runProposeIdeasGraph({
          worldId: state.worldId,
          articleId: item.articleId,
          introduction: state.inceptionIntro,
          selectedProposal,
          contextDepth: state.contextDepth,
        });
        selectedIdeas = ideasResult.ideas;
        await bumpRunBudget(state.runId, ideasResult.tokensIn + ideasResult.tokensOut);
      } catch {
        // Oracle failure is non-fatal — Scribe runs without ideas, same as the client loop.
      }
    }

    const expandResult = await runExpandGraph({
      worldId: state.worldId,
      articleId: item.articleId,
      pipelineType: 'expand_description',
      selectedProposal,
      contextDepth: state.contextDepth,
      selectedIdeas,
      runContinuityEditor: state.forgeUseContinuityEditor,
    });
    await bumpRunBudget(state.runId, expandResult.tokensIn + expandResult.tokensOut);

    await persistExpandDraft({
      articleId: item.articleId,
      ownerId: state.ownerId,
      description: expandResult.description,
      mentions: expandResult.mentions,
    });
    await acceptDraft({ worldId: state.worldId, articleId: item.articleId, ownerId: state.ownerId, activeRunId: state.runId });

    await logEvent(state.runId, 'Expansion', item.title, true);
    return { currentItemStepsDone: [...state.currentItemStepsDone, 'expansion'] };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state.runId, 'Expansion', item.title, false, errorMessage(err));
    return { lastStepError: { step: 'Expansion', fatal, message: errorMessage(err) }, ...(fatal ? { signal: 'error' as const } : {}) };
  }
}

async function branchingNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (item.depth >= state.forgeMaxDepth || state.currentItemStepsDone.includes('branching')) return {};

  try {
    const branchHint = state.branchingMode === 'specific'
      ? 'Prefer specific named instances (individual entities, real examples). '
      : 'Prefer conceptual categories and systems. ';

    const childResult = await runProposeChildrenGraph({
      worldId: state.worldId,
      articleId: item.articleId,
      contextDepth: state.contextDepth,
      userSpec: branchHint,
    });
    await bumpRunBudget(state.runId, childResult.tokensIn + childResult.tokensOut);

    const take = state.forgeMaxChildren > 0
      ? childResult.proposals.slice(0, state.forgeMaxChildren)
      : childResult.proposals;

    const batchResult = await batchCreateChildArticles({
      worldId: state.worldId,
      ownerId: state.ownerId,
      parentArticleId: item.articleId,
      children: take.map((p) => ({ title: p.title, introduction: p.introduction, templateType: p.templateType })),
    });

    const newItems: ForgeQueueItem[] = batchResult.created.map((c) => ({
      articleId: c.id,
      title: c.title,
      depth: item.depth + 1,
      startStep: 'inception' as const,
    }));

    await logEvent(state.runId, 'Branching', item.title, true);
    const total = state.total + newItems.length;
    await updateRunProgress(state.runId, state.completed, total);
    return {
      queue: state.forgeMode === 'breadth' ? [...state.queue, ...newItems] : [...newItems, ...state.queue],
      total,
      currentItemStepsDone: [...state.currentItemStepsDone, 'branching'],
    };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state.runId, 'Branching', item.title, false, errorMessage(err));
    return { lastStepError: { step: 'Branching', fatal, message: errorMessage(err) }, ...(fatal ? { signal: 'error' as const } : {}) };
  }
}

async function finishItemNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const completed = state.completed + 1;
  await updateRunProgress(state.runId, completed, state.total);
  return { completed, currentItem: undefined, currentItemStepsDone: [] };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const END_KEY = '__end__';

function routeAfterDequeue(state: ForgeState): 'inception' | typeof END_KEY {
  return state.signal === 'continue' ? 'inception' : END_KEY;
}

function routeAfterInception(state: ForgeState): 'expansion' | 'finishItem' | typeof END_KEY {
  if (state.lastStepError?.fatal) return END_KEY;
  if (state.lastStepError) return 'finishItem';
  return 'expansion';
}

function routeAfterExpansion(state: ForgeState): 'branching' | 'finishItem' | typeof END_KEY {
  if (state.lastStepError?.fatal) return END_KEY;
  if (state.lastStepError) return 'finishItem';
  return 'branching';
}

function routeAfterBranching(state: ForgeState): 'finishItem' | typeof END_KEY {
  return state.lastStepError?.fatal ? END_KEY : 'finishItem';
}

// ---------------------------------------------------------------------------
// Graph — one compiled instance per process, checkpointed on runId as thread_id
// ---------------------------------------------------------------------------

let graphPromise: ReturnType<typeof buildGraph> | null = null;

async function buildGraph() {
  const checkpointer = await getCheckpointer();
  return new StateGraph(ForgeAnnotation)
    .addNode('dequeue', dequeueNode)
    .addNode('inception', inceptionNode)
    .addNode('expansion', expansionNode)
    .addNode('branching', branchingNode)
    .addNode('finishItem', finishItemNode)
    .addEdge('__start__', 'dequeue')
    .addConditionalEdges('dequeue', routeAfterDequeue, { inception: 'inception', [END_KEY]: '__end__' })
    .addConditionalEdges('inception', routeAfterInception, { expansion: 'expansion', finishItem: 'finishItem', [END_KEY]: '__end__' })
    .addConditionalEdges('expansion', routeAfterExpansion, { branching: 'branching', finishItem: 'finishItem', [END_KEY]: '__end__' })
    .addConditionalEdges('branching', routeAfterBranching, { finishItem: 'finishItem', [END_KEY]: '__end__' })
    .addEdge('finishItem', 'dequeue')
    .compile({ checkpointer });
}

/** Exported for forgeGraph.test.ts only — production code should go through startForgeRun/resumeForgeRun. */
export function getForgeGraph() {
  if (!graphPromise) graphPromise = buildGraph();
  return graphPromise;
}

/**
 * Hard technical ceiling on graph super-steps, independent of the user-facing
 * forgeMaxDepth/forgeMaxChildren soft limits — same PoC-verified pattern used
 * elsewhere this session. 5 super-steps per queue item (dequeue/inception/
 * expansion/branching/finishItem); Cartographer caps children at 5 per branch.
 */
function computeRecursionLimit(forgeMaxDepth: number, forgeMaxChildren: number): number {
  const branchFactor = forgeMaxChildren > 0 ? forgeMaxChildren : 5;
  let totalItems = 0;
  let levelCount = 1;
  for (let d = 0; d <= forgeMaxDepth; d++) {
    totalItems += levelCount;
    levelCount *= branchFactor;
  }
  return Math.min(20_000, totalItems * 5 + 20);
}

async function finalizeRun(runId: string, worldId: string, result: ForgeState): Promise<void> {
  switch (result.signal) {
    case 'completed':
      await markRunStatus(runId, 'completed');
      await releaseLocks(worldId, runId);
      break;
    case 'paused':
      await markRunStatus(runId, 'paused');
      break;
    case 'error':
      await markRunStatus(runId, 'failed', result.lastStepError?.message);
      await releaseLocks(worldId, runId);
      break;
    case 'stopped':
      // Already set to 'stopped' + unlocked by runsService.cancelRun.
      break;
  }
}

// ---------------------------------------------------------------------------
// Entry points — called from routes/runs.ts, fire-and-forget (same
// no-streaming, poll-instead contract as the rest of this codebase's agent calls)
// ---------------------------------------------------------------------------

export async function startForgeRun(params: {
  runId: string;
  worldId: string;
  ownerId: string;
  articleId: string;
  articleTitle: string;
  startStep: ForgeQueueItem['startStep'];
  contextDepth: ContextDepth;
  branchingMode: 'specific' | 'conceptual';
  forgeMode: 'breadth' | 'depth';
  forgeMaxDepth: number;
  forgeMaxChildren: number;
  forgeUseOracle: boolean;
  forgeUseContinuityEditor: boolean;
}): Promise<void> {
  await markRunStatus(params.runId, 'running');
  await updateRunProgress(params.runId, 0, 1);
  const graph = await getForgeGraph();
  const config = {
    configurable: { thread_id: params.runId },
    recursionLimit: computeRecursionLimit(params.forgeMaxDepth, params.forgeMaxChildren),
  };

  try {
    const result = await graph.invoke(
      {
        worldId: params.worldId,
        runId: params.runId,
        ownerId: params.ownerId,
        ...contractState(forgeContract(params.articleId, params.forgeMaxDepth)),
        contextDepth: params.contextDepth,
        branchingMode: params.branchingMode,
        forgeMode: params.forgeMode,
        forgeMaxDepth: params.forgeMaxDepth,
        forgeMaxChildren: params.forgeMaxChildren,
        forgeUseOracle: params.forgeUseOracle,
        forgeUseContinuityEditor: params.forgeUseContinuityEditor,
        queue: [{ articleId: params.articleId, title: params.articleTitle, depth: 0, startStep: params.startStep }],
        total: 1,
      },
      config,
    );
    await finalizeRun(params.runId, params.worldId, result as ForgeState);
  } catch (err) {
    if (err instanceof GraphRecursionError) {
      await markRunStatus(params.runId, 'failed', 'Forge run exceeded its recursion limit.');
      await releaseLocks(params.worldId, params.runId);
      return;
    }
    await markRunStatus(params.runId, 'failed', errorMessage(err));
    await releaseLocks(params.worldId, params.runId);
  }
}

export async function resumeForgeRun(params: { runId: string; worldId: string }): Promise<void> {
  const graph = await getForgeGraph();
  const config = { configurable: { thread_id: params.runId } };

  const snapshot = await graph.getState(config);
  const restored = snapshot.values as ForgeState;
  if (!restored?.queue) {
    await markRunStatus(params.runId, 'failed', 'No checkpointed state found to resume from.');
    return;
  }

  await markRunStatus(params.runId, 'running');
  const invokeConfig = {
    ...config,
    recursionLimit: computeRecursionLimit(restored.forgeMaxDepth, restored.forgeMaxChildren),
  };

  try {
    const result = await graph.invoke(restored, invokeConfig);
    await finalizeRun(params.runId, params.worldId, result as ForgeState);
  } catch (err) {
    if (err instanceof GraphRecursionError) {
      await markRunStatus(params.runId, 'failed', 'Forge run exceeded its recursion limit.');
      await releaseLocks(params.worldId, params.runId);
      return;
    }
    await markRunStatus(params.runId, 'failed', errorMessage(err));
    await releaseLocks(params.worldId, params.runId);
  }
}
