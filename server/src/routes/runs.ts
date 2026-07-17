import { Router } from 'express';
import { z } from 'zod';
import type { Request } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';
import { getDbClient } from '../db/client.js';
import { createRun, getRun, listRuns, cancelRun, markRunStatus, listRunEvents, listRunAgentCalls, clearTerminalRunHistory, RunConflictError } from '../services/runsService.js';
import { isLlmTraceEnabled, listRunLlmTraces } from '../services/llmTraceService.js';
import { decideRunReviewItem, listRunReviewItems } from '../services/runReviewItems.js';
import { listRunQueueItems } from '../services/runQueueItems.js';
import { startForgeRun, resumeForgeRun } from '../agents/graphs/forgeGraph/index.js';
import { startConsolidateRun } from '../agents/graphs/consolidateRun.js';
import type { AutonomyMode, CommitPolicy, ReviewPolicy } from '../agents/graphs/masContract.js';
import type { ConsolidatePipelineType } from '../agents/graphs/consolidateRun.js';

const router = Router({ mergeParams: true });

function wid(req: Request): string {
  return (req.params as Record<string, string>).wid;
}

function rid(req: Request): string {
  return (req.params as Record<string, string>).rid;
}

router.get('/', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  res.json(await listRuns(worldId, ownerId));
}));

router.delete('/', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  res.json(await clearTerminalRunHistory(worldId, ownerId));
}));

router.get('/:rid', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const run = await getRun(worldId, ownerId, rid(req));
  if (!run) throw new AppError(404, 'NOT_FOUND', 'Run not found');
  const events = await listRunEvents(worldId, ownerId, rid(req));
  const agentCalls = await listRunAgentCalls(worldId, ownerId, rid(req));
  const reviewItems = await listRunReviewItems(worldId, ownerId, rid(req));
  const queueItems = await listRunQueueItems(worldId, ownerId, rid(req));
  res.json({ ...run, events, agentCalls, reviewItems, queueItems });
}));

const ReviewDecisionSchema = z.object({
  action: z.enum(['accept', 'reject']),
  decision: z.record(z.unknown()).optional().default({}),
});

router.post('/:rid/review-items/:reviewId/decision', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const run = await getRun(worldId, ownerId, rid(req));
  if (!run) throw new AppError(404, 'NOT_FOUND', 'Run not found');
  const parse = ReviewDecisionSchema.safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid review decision', parse.error.flatten().fieldErrors);

  const review = await decideRunReviewItem({
    worldId,
    ownerId,
    runId: run.id,
    reviewId: (req.params as Record<string, string>).reviewId,
    status: parse.data.action === 'accept' ? 'accepted' : 'rejected',
    decision: parse.data.decision,
  });

  void resumeForgeRun({ worldId, ownerId, runId: run.id }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Forge run ${run.id} crashed after review decision`, err);
  });

  res.json(review);
}));

router.get('/:rid/llm-traces', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const run = await getRun(worldId, ownerId, rid(req));
  if (!run) throw new AppError(404, 'NOT_FOUND', 'Run not found');
  if (!isLlmTraceEnabled()) {
    res.status(404).json({ error: 'LLM tracing is disabled.' });
    return;
  }
  res.json(await listRunLlmTraces(worldId, ownerId, run.id));
}));

const CreateRunSchema = z.object({
  articleIds: z.array(z.string().min(1)).optional().default([]),
  budgetLimit: z.number().int().positive().optional(),
  pipelineType: z.enum([
    'expand_description', 'create_child', 'propose_children',
    'reorganize', 'summarize', 'improve_intro', 'cohere', 'audit', 'concept_scan', 'fix_issue',
  ]),
  graphType: z.enum(['forge', 'consolidate']).optional(),
  contextDepth: z.enum(['shallow', 'mid', 'deep']).optional().default('mid'),
  contextBasis: z.enum(['current', 'latest_draft', 'published']).optional().default('current'),
  branchingMode: z.enum(['conceptual', 'specific']).optional().default('conceptual'),
  forgeMode: z.enum(['breadth', 'depth']).optional().default('breadth'),
  forgeMaxDepth: z.number().int().min(0).max(10).optional().default(2),
  forgeMaxChildren: z.number().int().min(0).max(20).optional().default(5),
  // One global dial covering Arbiter and Gatekeeper (Herald
  // has no dedicated checker). Defaults to 1 (single check-revise cycle, no
  // re-check) — matching Forge's previous always-on single-pass behavior
  // before this was user-configurable.
  coherenceCheckLevel: z.number().int().min(0).max(3).optional().default(1),
  safetyNet: z.boolean().optional().default(false),
  runStylizer: z.boolean().optional().default(false),
  userSpec: z.string().optional(),
  forgeContinuationMode: z.enum(['one_step', 'finish_document', 'recursive']).optional().default('recursive'),
  forgeInceptionExistingMode: z.enum(['create', 'improve', 'replace', 'skip_existing']).optional().default('improve'),
  forgeExpansionExistingMode: z.enum(['create', 'improve', 'replace', 'skip_existing']).optional().default('improve'),
  forgeBranchingExistingMode: z.enum(['append_deduped', 'skip_if_children']).optional().default('append_deduped'),
  validationLevel: z.enum(['manual', 'assisted', 'autopilot']).optional(),
  autonomyMode: z.enum(['manual', 'review_each_step', 'auto_with_post_review']).optional(),
  reviewPolicy: z.enum(['none', 'user_must_select', 'user_must_accept', 'auto']).optional(),
  commitPolicy: z.enum(['no_commit', 'pending_draft', 'auto_commit']).optional(),
});

/** Same derivation forgeSlice.ts's startForge already used client-side. */
function deriveStartStep(pipelineType: string): 'inception' | 'expansion' | 'branching' {
  if (pipelineType === 'propose_children') return 'branching';
  if (pipelineType === 'expand_description') return 'expansion';
  return 'inception';
}

function deriveRunPolicy(input: z.infer<typeof CreateRunSchema>): {
  autonomyMode: AutonomyMode;
  reviewPolicy: ReviewPolicy;
  commitPolicy: CommitPolicy;
} {
  const fromValidation = (() => {
    switch (input.validationLevel) {
      case 'manual':
        return {
          autonomyMode: 'manual' as const,
          reviewPolicy: 'user_must_accept' as const,
          commitPolicy: 'pending_draft' as const,
        };
      case 'assisted':
        return {
          autonomyMode: 'review_each_step' as const,
          reviewPolicy: 'user_must_accept' as const,
          commitPolicy: 'pending_draft' as const,
        };
      case 'autopilot':
        return {
          autonomyMode: 'auto_with_post_review' as const,
          reviewPolicy: 'auto' as const,
          commitPolicy: 'auto_commit' as const,
        };
      default:
        return {
          autonomyMode: 'auto_with_post_review' as const,
          reviewPolicy: 'auto' as const,
          commitPolicy: 'auto_commit' as const,
        };
    }
  })();

  return {
    autonomyMode: input.autonomyMode ?? fromValidation.autonomyMode,
    reviewPolicy: input.reviewPolicy ?? fromValidation.reviewPolicy,
    commitPolicy: input.commitPolicy ?? fromValidation.commitPolicy,
  };
}

const CONSOLIDATE_PIPELINES = new Set<string>(['reorganize', 'cohere', 'audit', 'concept_scan']);

function deriveGraphType(input: z.infer<typeof CreateRunSchema>): 'forge' | 'consolidate' {
  return input.graphType ?? (CONSOLIDATE_PIPELINES.has(input.pipelineType) ? 'consolidate' : 'forge');
}

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/runs — create + start a Forge run
//
// Fires the graph without awaiting it: a Forge run can recurse across many
// articles (Inception/Expansion/Branching per item) and must not hold this
// HTTP request open for its full duration. Progress is observed via GET /:rid
// (status/budgetUsed/events) — the same "no streaming, poll instead"
// limitation already accepted for single agent calls elsewhere in this
// codebase (see the streaming row in dev-docs/engineering/practices.md).
//
// Forge only ever starts from one root article (articleIds[0]) — the array
// shape is kept because createRun()/locking already operate on article lists.
// ---------------------------------------------------------------------------

router.post('/', asyncHandler(async (req, res) => {
  const parse = CreateRunSchema.safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { worldId, ownerId } = requireTenantContext(req);
  const { articleIds } = parse.data;
  const rootArticleId = articleIds[0];
  const graphType = deriveGraphType(parse.data);

  if (graphType === 'forge' && !rootArticleId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Forge runs require a starting article');
  }
  if (graphType === 'consolidate' && (parse.data.pipelineType === 'reorganize' || parse.data.pipelineType === 'cohere') && !rootArticleId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'This Consolidate pipeline requires an article target');
  }
  if (parse.data.pipelineType === 'fix_issue') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Issue fixes are launched from Inbox issue actions, not run creation');
  }

  let existing: Array<{ id: string; title: string }> = [];
  if (articleIds.length > 0) {
    const placeholders = articleIds.map(() => '?').join(',');
    existing = await getDbClient().all<{ id: string; title: string }>(
      `SELECT id, title FROM articles WHERE world_id = ? AND owner_id = ? AND id IN (${placeholders})`,
      [worldId, ownerId, ...articleIds],
    );
    if (existing.length !== articleIds.length) {
      throw new AppError(404, 'NOT_FOUND', 'One or more articles not found in this world');
    }
  }
  const rootArticle = rootArticleId ? existing.find((a) => a.id === rootArticleId)! : null;
  const runPolicy = deriveRunPolicy(parse.data);
  const startStep = deriveStartStep(parse.data.pipelineType);
  const runConfig = {
    ...parse.data,
    rootArticleId,
    startStep,
    autonomyMode: runPolicy.autonomyMode,
    reviewPolicy: runPolicy.reviewPolicy,
    commitPolicy: runPolicy.commitPolicy,
  };
  const lockedArticleIds = graphType === 'consolidate' && parse.data.pipelineType === 'audit' ? [] : articleIds;

  let run;
  try {
    run = await createRun({
      worldId,
      ownerId,
      articleIds: lockedArticleIds,
      budgetLimit: parse.data.budgetLimit,
      graphType,
      config: runConfig,
    });
  } catch (err) {
    if (err instanceof RunConflictError) {
      throw new AppError(409, 'ARTICLE_LOCKED', err.message, { articleIds: err.lockedArticleIds });
    }
    throw err;
  }

  if (graphType === 'consolidate') {
    void startConsolidateRun({
      runId: run.id,
      worldId,
      ownerId,
      pipelineType: parse.data.pipelineType as ConsolidatePipelineType,
      articleId: rootArticle?.id,
      articleTitle: rootArticle?.title,
      contextDepth: parse.data.contextDepth,
      contextBasis: parse.data.contextBasis,
      focus: 'all',
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Consolidate run ${run.id} crashed outside its own error handling`, err);
    });
  } else {
    void startForgeRun({
      runId: run.id,
      worldId,
      ownerId,
      articleId: rootArticleId,
      articleTitle: rootArticle!.title,
      startStep,
      contextDepth: parse.data.contextDepth,
      contextBasis: parse.data.contextBasis,
      branchingMode: parse.data.branchingMode,
      forgeMode: parse.data.forgeMode,
      forgeMaxDepth: parse.data.forgeMaxDepth,
      forgeMaxChildren: parse.data.forgeMaxChildren,
      coherenceCheckLevel: parse.data.coherenceCheckLevel,
      safetyNet: parse.data.safetyNet,
      runStylizer: parse.data.runStylizer,
      userSpec: parse.data.userSpec,
      forgeContinuationMode: parse.data.forgeContinuationMode,
      forgeInceptionExistingMode: parse.data.forgeInceptionExistingMode,
      forgeExpansionExistingMode: parse.data.forgeExpansionExistingMode,
      forgeBranchingExistingMode: parse.data.forgeBranchingExistingMode,
      autonomyMode: runPolicy.autonomyMode,
      reviewPolicy: runPolicy.reviewPolicy,
      commitPolicy: runPolicy.commitPolicy,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Forge run ${run.id} crashed outside its own error handling`, err);
    });
  }

  res.status(202).json(run);
}));

router.post('/:rid/cancel', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const run = await cancelRun(worldId, ownerId, rid(req));
  if (!run) throw new AppError(404, 'NOT_FOUND', 'Run not found');
  res.json(run);
}));

router.post('/:rid/pause', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const run = await getRun(worldId, ownerId, rid(req));
  if (!run) throw new AppError(404, 'NOT_FOUND', 'Run not found');
  if (run.status !== 'running' && run.status !== 'pending') {
    throw new AppError(409, 'RUN_NOT_RUNNING', 'Run is not currently running');
  }

  // Takes effect at the next per-item queue boundary — the Forge graph's
  // dequeue node checks status before popping the next item, same
  // granularity forgeSlice.ts's client-side pauseForge already had.
  await markRunStatus(worldId, ownerId, run.id, 'paused');
  res.json({ ...run, status: 'paused' });
}));

// A 'running' run whose updated_at hasn't moved in this long almost certainly
// belongs to a process that crashed or was killed mid-invoke (fire-and-forget
// startForgeRun/resumeForgeRun never get the chance to mark a terminal status
// in that case) — the checkpointer already made this recoverable, so treat it
// the same as an explicitly paused run rather than leaving it stuck forever.
const STALE_RUN_MS = 60_000;

router.post('/:rid/resume', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const run = await getRun(worldId, ownerId, rid(req));
  if (!run) throw new AppError(404, 'NOT_FOUND', 'Run not found');
  const isStaleRunning = run.status === 'running' && Date.now() - run.updatedAt > STALE_RUN_MS;
  if (run.status !== 'paused' && run.status !== 'needs_input' && !isStaleRunning) {
    throw new AppError(409, 'RUN_NOT_PAUSED', 'Run is not currently paused');
  }

  void resumeForgeRun({ worldId, ownerId, runId: run.id }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Forge run ${run.id} crashed on resume`, err);
  });

  res.status(202).json({ ...run, status: 'running' });
}));

export default router;
