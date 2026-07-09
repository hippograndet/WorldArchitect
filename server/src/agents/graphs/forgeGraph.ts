import { nanoid } from 'nanoid';
import { StateGraph, GraphRecursionError } from '@langchain/langgraph';
import { getDbClient } from '../../db/client.js';
import { upsertEntry } from '../../services/worldBible.js';
import { acceptDraft, batchCreateChildArticles } from '../../services/articlesService.js';
import { getRun, markRunStatus, bumpRunBudget, releaseLocks, updateRunProgress } from '../../services/runsService.js';
import { recordArticleIssues } from '../../services/issueRecorder.js';
import { getCheckpointer } from '../checkpointer.js';
import { runWithUserContext } from '../../requestContext.js';
import { runSummarizeGraph } from './pipelines/summarize.js';
import { runProposeGraph } from './pipelines/propose.js';
import { runProposeIdeasGraph } from './pipelines/proposeIdeas.js';
import { runExpandGraph } from './pipelines/expand.js';
import { runProposeChildrenGraph } from './pipelines/proposeChildren.js';
import { ForgeAnnotation } from './forgeState.js';
import { contractState, forgeContract } from './masContract.js';
import type {
  ForgeState,
  ForgeQueueItem,
  ForgeContinuationMode,
  ForgeExistingContentMode,
  ForgeBranchingExistingMode,
} from './forgeState.js';
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

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function getCurrentIntro(worldId: string, ownerId: string, articleId: string): Promise<string> {
  const row = await getDbClient().get<{ summary: string }>(
    'SELECT summary FROM world_bible_entries WHERE world_id = ? AND owner_id = ? AND article_id = ?',
    [worldId, ownerId, articleId],
  );
  return row?.summary ?? '';
}

async function getCurrentDescription(ownerId: string, articleId: string): Promise<string> {
  const row = await getDbClient().get<{ description: string }>(
    `SELECT av.description
     FROM articles a
     LEFT JOIN article_versions av ON av.id = a.current_version_id
     WHERE a.id = ? AND a.owner_id = ?`,
    [articleId, ownerId],
  );
  return row?.description ?? '';
}

async function getChildCount(ownerId: string, articleId: string): Promise<number> {
  const row = await getDbClient().get<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM article_links
     WHERE source_article_id = ? AND owner_id = ? AND link_type = 'hierarchical'`,
    [articleId, ownerId],
  );
  return row?.count ?? 0;
}

async function logEvent(state: Pick<ForgeState, 'runId' | 'worldId' | 'ownerId'>, step: string, title: string, ok: boolean, message?: string): Promise<void> {
  await getDbClient().run(
    `INSERT INTO run_events (id, run_id, step, title, ok, message, created_at)
     SELECT ?, r.id, ?, ?, ?, ?, ?
       FROM runs r
      WHERE r.id = ? AND r.world_id = ? AND r.owner_id = ?`,
    [nanoid(), step, title, ok ? 1 : 0, message ?? null, Date.now(), state.runId, state.worldId, state.ownerId],
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
    'SELECT id FROM pending_drafts WHERE article_id = ? AND owner_id = ? AND pipeline_type = ?',
    [params.articleId, params.ownerId, 'expand_description'],
  );
  if (existing) {
    await exec.run(
      `UPDATE pending_drafts SET draft_content = ?, updated_at = ? WHERE article_id = ? AND owner_id = ? AND pipeline_type = ?`,
      [JSON.stringify(draftContent), now, params.articleId, params.ownerId, 'expand_description'],
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
    const existingIntro = await getCurrentIntro(state.worldId, state.ownerId, item.articleId);
    const hasExistingIntro = existingIntro.trim().length > 0;
    if (hasExistingIntro && (state.forgeInceptionExistingMode === 'skip_existing' || state.forgeInceptionExistingMode === 'create')) {
      await logEvent(state, 'Inception', item.title, true, 'Skipped existing introduction.');
      return { inceptionIntro: existingIntro, currentItemStepsDone: [...state.currentItemStepsDone, 'inception'] };
    }

    const summarizeMode = state.forgeInceptionExistingMode === 'improve' ? 'improve' : 'full';
    const result = await runSummarizeGraph({
      worldId: state.worldId,
      articleId: item.articleId,
      mode: summarizeMode,
      pipelineRunId: state.runId,
      runGroundingCheck: state.forgeUseGroundingCheck,
    });
    await bumpRunBudget(state.worldId, state.ownerId, state.runId, result.tokensIn + result.tokensOut);

    if (state.forgeUseGroundingCheck && result.groundingCheck && !result.groundingCheck.approved) {
      await recordArticleIssues(getDbClient(), {
        worldId: state.worldId,
        ownerId: state.ownerId,
        articleId: item.articleId,
        source: 'grounding_check',
        issues: result.groundingCheck.contradictions.map((c) => ({
          severity: 'warning',
          code: 'GROUNDING_CONTRADICTION',
          excerpt: c.excerpt,
          explanation: c.issue,
          suggestion: c.correction,
        })),
      });
      await logEvent(state, 'Inception', item.title, false, 'Grounding check failed after revision — introduction not grounded in parent/world context.');
      // Deliberately skip upsertEntry(): an ungrounded intro must never be
      // committed to the World Bible, since Expansion/Branching and every
      // descendant would otherwise read it as trusted context.
      return { lastStepError: { step: 'Inception', fatal: false, message: 'Grounding check failed after revision.' } };
    }

    const introWordCount = countWords(result.introduction);
    if (introWordCount < 15) {
      const message = `Inception generated only ${introWordCount} word${introWordCount === 1 ? '' : 's'}; expected at least 15 words for a usable introduction. Nothing was saved.`;
      await logEvent(state, 'Inception', item.title, false, message);
      return { lastStepError: { step: 'Inception', fatal: false, message } };
    }

    await upsertEntry(getDbClient(), state.worldId, item.articleId, result.introduction);
    await logEvent(state, 'Inception', item.title, true, `Saved ${introWordCount}-word introduction.`);
    return { inceptionIntro: result.introduction, currentItemStepsDone: [...state.currentItemStepsDone, 'inception'] };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state, 'Inception', item.title, false, errorMessage(err));
    return { lastStepError: { step: 'Inception', fatal, message: errorMessage(err) }, ...(fatal ? { signal: 'error' as const } : {}) };
  }
}

async function expansionNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (item.startStep === 'branching' || state.currentItemStepsDone.includes('expansion')) return {};

  try {
    const existingDescription = await getCurrentDescription(state.ownerId, item.articleId);
    if (existingDescription.trim() && (state.forgeExpansionExistingMode === 'skip_existing' || state.forgeExpansionExistingMode === 'create')) {
      await logEvent(state, 'Expansion', item.title, true, 'Skipped existing description.');
      return { currentItemStepsDone: [...state.currentItemStepsDone, 'expansion'] };
    }

    const proposeResult = await runProposeGraph({
      worldId: state.worldId,
      articleId: item.articleId,
      pipelineType: 'expand_description',
      autoSelect: true,
      contextDepth: state.contextDepth,
      pipelineRunId: state.runId,
    });
    const selectedIndex = proposeResult.autoSelectedIndex ?? 0;
    const selectedProposal = proposeResult.proposals[selectedIndex];
    await bumpRunBudget(state.worldId, state.ownerId, state.runId, proposeResult.tokensIn + proposeResult.tokensOut);

    let selectedIdeas: Awaited<ReturnType<typeof runProposeIdeasGraph>>['ideas'] | undefined;
    if (state.forgeUseOracle && state.inceptionIntro?.trim() && selectedProposal) {
      try {
        const ideasResult = await runProposeIdeasGraph({
          worldId: state.worldId,
          articleId: item.articleId,
          introduction: state.inceptionIntro,
          selectedProposal,
          contextDepth: state.contextDepth,
          pipelineRunId: state.runId,
        });
        selectedIdeas = ideasResult.ideas;
        await bumpRunBudget(state.worldId, state.ownerId, state.runId, ideasResult.tokensIn + ideasResult.tokensOut);
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
      userSpec: state.forgeExpansionExistingMode === 'replace'
        ? 'Replace the current description completely. Do not preserve old wording unless it is required by established world facts.'
        : undefined,
      runContinuityEditor: state.forgeUseContinuityEditor,
      pipelineRunId: state.runId,
    });
    await bumpRunBudget(state.worldId, state.ownerId, state.runId, expandResult.tokensIn + expandResult.tokensOut);

    await persistExpandDraft({
      articleId: item.articleId,
      ownerId: state.ownerId,
      description: expandResult.description,
      mentions: expandResult.mentions,
    });
    await acceptDraft({ worldId: state.worldId, articleId: item.articleId, ownerId: state.ownerId, activeRunId: state.runId });

    await logEvent(state, 'Expansion', item.title, true, 'Description saved.');
    return { currentItemStepsDone: [...state.currentItemStepsDone, 'expansion'] };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state, 'Expansion', item.title, false, errorMessage(err));
    return { lastStepError: { step: 'Expansion', fatal, message: errorMessage(err) }, ...(fatal ? { signal: 'error' as const } : {}) };
  }
}

async function branchingNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const item = state.currentItem!;
  if (item.depth >= state.forgeMaxDepth || state.currentItemStepsDone.includes('branching')) return {};

  try {
    const existingChildren = await getChildCount(state.ownerId, item.articleId);
    if (existingChildren > 0 && state.forgeBranchingExistingMode === 'skip_if_children') {
      await logEvent(state, 'Branching', item.title, true, `Skipped branching because ${existingChildren} child article${existingChildren === 1 ? '' : 's'} already exist.`);
      return { currentItemStepsDone: [...state.currentItemStepsDone, 'branching'] };
    }

    const branchHint = state.branchingMode === 'specific'
      ? 'Prefer specific named instances (individual entities, real examples). '
      : 'Prefer conceptual categories and systems. ';

    const childResult = await runProposeChildrenGraph({
      worldId: state.worldId,
      articleId: item.articleId,
      contextDepth: state.contextDepth,
      userSpec: branchHint,
      pipelineRunId: state.runId,
      runDedupCheck: state.forgeUseDedupCheck,
    });
    await bumpRunBudget(state.worldId, state.ownerId, state.runId, childResult.tokensIn + childResult.tokensOut);

    if (childResult.dedupCheck?.duplicates.length) {
      await recordArticleIssues(getDbClient(), {
        worldId: state.worldId,
        ownerId: state.ownerId,
        articleId: item.articleId,
        source: 'dedup_check',
        issues: childResult.dedupCheck.duplicates.map((d) => ({
          severity: 'info',
          code: 'DUPLICATE_PROPOSAL_FILTERED',
          explanation: `Proposed child "${d.proposalTitle}" filtered as a likely duplicate of existing article "${d.matchedExisting}": ${d.rationale}`,
        })),
      });
    }

    // childResult.proposals already has any flagged duplicates filtered out
    // by cartographerNode itself — no additional filtering needed here.
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

    const shouldQueueChildren = state.forgeContinuationMode === 'recursive';
    await logEvent(state, 'Branching', item.title, true, `Created ${newItems.length} child article${newItems.length === 1 ? '' : 's'}.`);
    const total = shouldQueueChildren ? state.total + newItems.length : state.total;
    await updateRunProgress(state.worldId, state.ownerId, state.runId, state.completed, total);
    return {
      queue: shouldQueueChildren
        ? (state.forgeMode === 'breadth' ? [...state.queue, ...newItems] : [...newItems, ...state.queue])
        : state.queue,
      total,
      currentItemStepsDone: [...state.currentItemStepsDone, 'branching'],
    };
  } catch (err) {
    const fatal = isFatal(err);
    await logEvent(state, 'Branching', item.title, false, errorMessage(err));
    return { lastStepError: { step: 'Branching', fatal, message: errorMessage(err) }, ...(fatal ? { signal: 'error' as const } : {}) };
  }
}

async function finishItemNode(state: ForgeState): Promise<Partial<ForgeState>> {
  const completed = state.completed + 1;
  // Fatal errors never reach this node (they route straight to END_KEY), so any
  // lastStepError here is non-fatal — the item was still counted "completed"
  // for progress purposes, but its step failed and finalizeRun needs to know.
  const failedItemCount = state.failedItemCount + (state.lastStepError ? 1 : 0);
  await updateRunProgress(state.worldId, state.ownerId, state.runId, completed, state.total);
  return { completed, failedItemCount, currentItem: undefined, currentItemStepsDone: [] };
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
  if (state.forgeContinuationMode === 'one_step') return 'finishItem';
  return 'expansion';
}

function routeAfterExpansion(state: ForgeState): 'branching' | 'finishItem' | typeof END_KEY {
  if (state.lastStepError?.fatal) return END_KEY;
  if (state.lastStepError) return 'finishItem';
  if (state.forgeContinuationMode === 'one_step') return 'finishItem';
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
    case 'error':
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
  branchingMode: 'specific' | 'conceptual';
  forgeMode: 'breadth' | 'depth';
  forgeMaxDepth: number;
  forgeMaxChildren: number;
  forgeUseOracle: boolean;
  forgeUseContinuityEditor: boolean;
  forgeUseGroundingCheck: boolean;
  forgeUseDedupCheck: boolean;
  forgeContinuationMode?: ForgeContinuationMode;
  forgeInceptionExistingMode?: ForgeExistingContentMode;
  forgeExpansionExistingMode?: ForgeExistingContentMode;
  forgeBranchingExistingMode?: ForgeBranchingExistingMode;
}): Promise<void> {
  await runWithUserContext(params.ownerId, async () => {
    await markRunStatus(params.worldId, params.ownerId, params.runId, 'running');
    await updateRunProgress(params.worldId, params.ownerId, params.runId, 0, 1);
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
          forgeUseGroundingCheck: params.forgeUseGroundingCheck,
          forgeUseDedupCheck: params.forgeUseDedupCheck,
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
