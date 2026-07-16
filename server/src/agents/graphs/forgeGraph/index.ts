import { StateGraph, GraphRecursionError } from '@langchain/langgraph';
import { markRunStatus, releaseLocks, updateRunProgress } from '../../../services/runsService.js';
import { insertRunQueueItems, markRunQueueItemFinished } from '../../../services/runQueueItems.js';
import { getCheckpointer } from '../../checkpointer.js';
import { runWithUserContext } from '../../../requestContext.js';
import { fetchWorldContext } from '../../director.js';
import { getWorldInfoContext } from '../../../services/archivist.js';
import { ForgeAnnotation } from '../forgeState.js';
import { contractState, expandRunContract } from '../masContract.js';
import { errorMessage } from './helpers.js';
import { dequeueNode, researchNode, inceptionNode, expansionNode, branchingNode, finishItemNode } from './nodes.js';
import { routeAfterDequeue, routeAfterResearch, routeAfterInception, routeAfterExpansion, routeAfterBranching, END_KEY } from './routing.js';
import type { AutonomyMode, CommitPolicy, ReviewPolicy } from '../masContract.js';
import type {
  ForgeState,
  ForgeQueueItem,
  ForgeContinuationMode,
  ForgeExistingContentMode,
  ForgeBranchingExistingMode,
} from '../forgeState.js';
import type { ContextDepth } from '../../../services/archivist.js';
import type { DraftContextBasis } from '../../../services/draftsService.js';

// ---------------------------------------------------------------------------
// Graph — one compiled instance per process, checkpointed on runId as thread_id
// ---------------------------------------------------------------------------

let graphPromise: ReturnType<typeof buildGraph> | null = null;

async function buildGraph() {
  const checkpointer = await getCheckpointer();
  return new StateGraph(ForgeAnnotation)
    .addNode('dequeue', dequeueNode)
    .addNode('research', researchNode)
    .addNode('inception', inceptionNode)
    .addNode('expansion', expansionNode)
    .addNode('branching', branchingNode)
    .addNode('finishItem', finishItemNode)
    .addEdge('__start__', 'dequeue')
    .addConditionalEdges('dequeue', routeAfterDequeue, { research: 'research', [END_KEY]: '__end__' })
    .addConditionalEdges('research', routeAfterResearch, { inception: 'inception', [END_KEY]: '__end__' })
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
 * elsewhere this session. 6 super-steps per queue item (dequeue/research/
 * inception/expansion/branching/finishItem); Cartographer caps children at 5
 * per branch.
 */
function computeRecursionLimit(forgeMaxDepth: number, forgeMaxChildren: number): number {
  const branchFactor = forgeMaxChildren > 0 ? forgeMaxChildren : 5;
  let totalItems = 0;
  let levelCount = 1;
  for (let d = 0; d <= forgeMaxDepth; d++) {
    totalItems += levelCount;
    levelCount *= branchFactor;
  }
  return Math.min(20_000, totalItems * 6 + 20);
}

async function finalizeRun(runId: string, worldId: string, ownerId: string, result: ForgeState): Promise<void> {
  switch (result.signal) {
    case 'completed':
      if (result.failedItemCount > 0) {
        // The queue drained without a fatal error, but at least one item's step
        // failed (e.g. a timeout) — surface this as 'failed' rather than a
        // misleading 'completed', matching the failed-step banner the client
        // already derives from run_events.
        await markRunStatus(
          worldId, ownerId, runId, 'failed',
          `${result.failedItemCount} of ${result.total} item${result.total === 1 ? '' : 's'} failed to complete a step. See step history for details.`,
        );
      } else {
        await markRunStatus(worldId, ownerId, runId, 'completed');
      }
      await releaseLocks(worldId, ownerId, runId);
      break;
    case 'paused':
      await markRunStatus(worldId, ownerId, runId, 'paused');
      break;
    case 'needs_input':
      await markRunStatus(worldId, ownerId, runId, 'needs_input');
      break;
    case 'error':
      // Fatal errors route straight to END_KEY, skipping finishItemNode — the
      // in-flight item's run_queue_items row would otherwise be stuck 'active' forever.
      if (result.currentItem) {
        await markRunQueueItemFinished(worldId, ownerId, runId, result.currentItem.articleId, 'failed');
      }
      await markRunStatus(worldId, ownerId, runId, 'failed', result.lastStepError?.message);
      await releaseLocks(worldId, ownerId, runId);
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
  contextBasis: DraftContextBasis;
  branchingMode: 'specific' | 'conceptual';
  forgeMode: 'breadth' | 'depth';
  forgeMaxDepth: number;
  forgeMaxChildren: number;
  coherenceCheckLevel: number;
  safetyNet: boolean;
  runStylizer?: boolean;
  userSpec?: string;
  forgeContinuationMode?: ForgeContinuationMode;
  forgeInceptionExistingMode?: ForgeExistingContentMode;
  forgeExpansionExistingMode?: ForgeExistingContentMode;
  forgeBranchingExistingMode?: ForgeBranchingExistingMode;
  autonomyMode?: AutonomyMode;
  reviewPolicy?: ReviewPolicy;
  commitPolicy?: CommitPolicy;
}): Promise<void> {
  await runWithUserContext(params.ownerId, async () => {
    await markRunStatus(params.worldId, params.ownerId, params.runId, 'running');
    await updateRunProgress(params.worldId, params.ownerId, params.runId, 0, 1);
    await insertRunQueueItems(params.worldId, params.ownerId, params.runId, [
      { articleId: params.articleId, title: params.articleTitle, depth: 0, startStep: params.startStep },
    ]);
    const graph = await getForgeGraph();
    const config = {
      configurable: { thread_id: params.runId },
      recursionLimit: computeRecursionLimit(params.forgeMaxDepth, params.forgeMaxChildren),
    };
    // Fetched once for the whole run — world-level metadata (name/tone/style)
    // can't change mid-run, so every node reuses this instead of re-fetching.
    const worldContext = await fetchWorldContext(params.worldId);
    const worldInfoContext = await getWorldInfoContext(params.worldId, params.ownerId);

    try {
      const result = await graph.invoke(
        {
          worldId: params.worldId,
          runId: params.runId,
          ownerId: params.ownerId,
          worldContext,
          worldInfoContext,
          ...contractState(expandRunContract({
            rootArticleId: params.articleId,
            maxDepth: params.forgeMaxDepth,
            autonomyMode: params.autonomyMode,
            reviewPolicy: params.reviewPolicy,
            commitPolicy: params.commitPolicy,
          })),
          contextDepth: params.contextDepth,
          contextBasis: params.contextBasis,
          branchingMode: params.branchingMode,
          forgeMode: params.forgeMode,
          forgeMaxDepth: params.forgeMaxDepth,
          forgeMaxChildren: params.forgeMaxChildren,
          coherenceCheckLevel: params.coherenceCheckLevel,
          safetyNet: params.safetyNet,
          runStylizer: params.runStylizer ?? false,
          userSpec: params.userSpec,
          forgeContinuationMode: params.forgeContinuationMode ?? 'recursive',
          forgeInceptionExistingMode: params.forgeInceptionExistingMode ?? 'improve',
          forgeExpansionExistingMode: params.forgeExpansionExistingMode ?? 'improve',
          forgeBranchingExistingMode: params.forgeBranchingExistingMode ?? 'append_deduped',
          queue: [{ articleId: params.articleId, title: params.articleTitle, depth: 0, startStep: params.startStep }],
          total: 1,
        },
        config,
      );
      await finalizeRun(params.runId, params.worldId, params.ownerId, result as ForgeState);
    } catch (err) {
      if (err instanceof GraphRecursionError) {
        await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', 'Forge run exceeded its recursion limit.');
        await releaseLocks(params.worldId, params.ownerId, params.runId);
        return;
      }
      await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', errorMessage(err));
      await releaseLocks(params.worldId, params.ownerId, params.runId);
    }
  });
}

export async function resumeForgeRun(params: { runId: string; worldId: string; ownerId: string }): Promise<void> {
  await runWithUserContext(params.ownerId, async () => {
    const graph = await getForgeGraph();
    const config = { configurable: { thread_id: params.runId } };

    const snapshot = await graph.getState(config);
    const restored = snapshot.values as ForgeState;
    if (!restored?.queue) {
      await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', 'No checkpointed state found to resume from.');
      return;
    }
    // Backfills runs checkpointed before worldContext/worldInfoContext
    // caching existed — a missing value here is otherwise just today's
    // normal cache-miss case.
    if (!restored.worldContext) {
      restored.worldContext = await fetchWorldContext(params.worldId);
    }
    if (!restored.worldInfoContext) {
      restored.worldInfoContext = await getWorldInfoContext(params.worldId, params.ownerId);
    }

    await markRunStatus(params.worldId, params.ownerId, params.runId, 'running');
    const invokeConfig = {
      ...config,
      recursionLimit: computeRecursionLimit(restored.forgeMaxDepth, restored.forgeMaxChildren),
    };

    try {
      const result = await graph.invoke(restored, invokeConfig);
      const finalState = result as ForgeState;
      await finalizeRun(params.runId, params.worldId, params.ownerId, finalState);
    } catch (err) {
      if (err instanceof GraphRecursionError) {
        await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', 'Forge run exceeded its recursion limit.');
        await releaseLocks(params.worldId, params.ownerId, params.runId);
        return;
      }
      await markRunStatus(params.worldId, params.ownerId, params.runId, 'failed', errorMessage(err));
      await releaseLocks(params.worldId, params.ownerId, params.runId);
    }
  });
}
