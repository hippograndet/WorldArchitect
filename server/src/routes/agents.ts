import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireLLM, isLLMConfigured, getProvider } from '../providers/index.js';
import { renderBible, getBibleMeta } from '../services/worldBible.js';
import { checkDailyCap } from '../services/callLogger.js';
import { PipelineCoordinator } from '../agents/director.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { getDbClient } from '../db/client.js';
import { requireTenantContext } from '../tenant.js';
import { recordArticleIssues, recordWorldIssues, recordProposedLinks } from '../services/issueRecorder.js';
import { assertArticleUnlocked } from '../services/runsService.js';
import { savePendingDraft } from '../services/draftsService.js';
import { getAgentCostProfiles, getPipelineTemplates, estimateRun, RunEstimateRequestSchema } from '../agents/costModel.js';
import type { Request, Response, NextFunction } from 'express';

const router = Router({ mergeParams: true });

// Module-level singleton — PipelineCoordinator has no per-request state
const coordinator = new PipelineCoordinator();

// ---------------------------------------------------------------------------
// Middleware: daily cap check
// ---------------------------------------------------------------------------

const checkCap = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const { allowed, current, cap } = await checkDailyCap(worldId, ownerId);
  if (!allowed) {
    res.status(429).json({ error: `Daily call cap reached (${current}/${cap}).`, code: 'DAILY_CAP' });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/agents/cost-profile
// ---------------------------------------------------------------------------

router.get('/cost-profile', asyncHandler(async (_req, res) => {
  res.json({
    agents: getAgentCostProfiles(),
    pipelines: getPipelineTemplates(),
  });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/estimate-run
// ---------------------------------------------------------------------------

router.post('/estimate-run', asyncHandler(async (req, res) => {
  const parse = RunEstimateRequestSchema.safeParse(req.body ?? {});
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);
  res.json(estimateRun(parse.data));
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/estimate
// ---------------------------------------------------------------------------

router.post('/estimate', asyncHandler(async (req, res) => {
  const parse = z.object({ extraText: z.string().optional() }).safeParse(req.body ?? {});
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { worldId, ownerId } = requireTenantContext(req);
  const bibleText = await renderBible(worldId, ownerId);
  const combined = parse.data.extraText ? `${bibleText}\n\n${parse.data.extraText}` : bibleText;

  let estimatedTokens: number;
  try {
    estimatedTokens = (await isLLMConfigured(ownerId))
      ? await (await getProvider(ownerId)).estimateTokens(combined)
      : Math.ceil(combined.length / 4);
  } catch {
    estimatedTokens = Math.ceil(combined.length / 4);
  }

  res.json({ estimatedTokens });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/propose  — Phase 1
// Returns 5-10 thematic ideas (Muse) for the user, or Curator, to select from.
// ---------------------------------------------------------------------------

const ContextDepthSchema = z.enum(['shallow', 'mid', 'deep']).optional().default('mid');
const ContextBasisSchema = z.enum(['current', 'latest_draft', 'published']).optional().default('current');
// Default 0 (off) here, matching these routes' prior runContinuityEditor/runDedupCheck
// defaults of false — unlike routes/runs.ts's Forge CreateRunSchema, which defaults to 1
// to match Forge's previous always-on single-pass behavior.
const CoherenceCheckLevelSchema = z.number().int().min(0).max(3).optional().default(0);
const SafetyNetSchema = z.boolean().optional().default(false);

const ProposeSchema = z.object({
  articleId:    z.string().min(1),
  pipelineType: z.enum(['expand_description', 'create_root', 'create_child']),
  userSpec:     z.string().optional(),
  autoSelect:   z.boolean().optional().default(false),
  contextDepth: ContextDepthSchema,
  contextBasis: ContextBasisSchema,
});

router.post('/propose', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = ProposeSchema.safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { worldId, ownerId } = requireTenantContext(req);
  await assertArticleUnlocked(worldId, ownerId, parse.data.articleId);
  const result = await coordinator.propose(
    worldId,
    parse.data.articleId,
    parse.data.pipelineType,
    parse.data.userSpec,
    parse.data.autoSelect,
    parse.data.contextDepth,
    parse.data.contextBasis,
  );
  res.json({
    ideas: result.ideas,
    contextDraftIds: result.contextDraftIds ?? [],
    ...(result.autoSelectedIndices !== undefined
      ? { autoSelectedIndices: result.autoSelectedIndices, autoSelectRationale: result.autoSelectRationale }
      : {}),
  });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/expand  — Phase 2
// Scribe → Lorekeeper → (optional StyleWarden)
// ---------------------------------------------------------------------------

const ExpandSchema = z.object({
  articleId:              z.string().min(1),
  pipelineType:           z.enum(['expand_description', 'create_root', 'create_child', 'reorganize']),
  selectedIdeas:          z.array(z.object({ id: z.string(), theme: z.string(), detail: z.string() })).optional(),
  userSpec:               z.string().optional(),
  contextDepth:           ContextDepthSchema,
  contextBasis:           ContextBasisSchema,
  runStyleWarden:         z.boolean().optional().default(false),
  coherenceCheckLevel:    CoherenceCheckLevelSchema,
  safetyNet:              SafetyNetSchema,
  wordCountPreset:        z.enum(['short', 'medium', 'long']).optional().default('medium'),
});

router.post('/expand', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = ExpandSchema.safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { articleId, pipelineType, selectedIdeas, userSpec, contextDepth, contextBasis, runStyleWarden, coherenceCheckLevel, safetyNet, wordCountPreset } = parse.data;

  const { worldId, ownerId } = requireTenantContext(req);
  await assertArticleUnlocked(worldId, ownerId, articleId);
  const sourceRunId = nanoid();
  const result = await coordinator.expand(worldId, articleId, pipelineType, userSpec, contextDepth, selectedIdeas, runStyleWarden, coherenceCheckLevel, safetyNet, wordCountPreset, contextBasis);

  // Persist draft so POST /accept can commit it
  const draftContent = pipelineType === 'create_child'
    ? { childDescription: result.description, introduction: result.introduction }
    : { description: result.description };

  const draft = await savePendingDraft({
    worldId,
    ownerId,
    articleId,
    pipelineType,
    phase: 'done',
    selectedProposal: selectedIdeas ? { selectedIdeas } : undefined,
    draftContent,
    parentUpdate: result.parentUpdate ? { articleId, appendText: result.parentUpdate.appendText } : undefined,
    sourceRunId,
    runType: pipelineType,
    contextBasis,
    contextDraftIds: result.contextDraftIds ?? [],
    displayTitle: pipelineType === 'create_child' ? 'Child subject draft' : 'Expansion draft',
  });

  res.json({ ...result, draft });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/propose-children
// Cartographer — proposes 10 child stubs from existing description
// ---------------------------------------------------------------------------

router.post('/propose-children', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({
    articleId:           z.string().min(1),
    userSpec:            z.string().optional(),
    contextDepth:        ContextDepthSchema,
    contextBasis:        ContextBasisSchema,
    coherenceCheckLevel: CoherenceCheckLevelSchema,
    safetyNet:           SafetyNetSchema,
  }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { worldId, ownerId } = requireTenantContext(req);
  await assertArticleUnlocked(worldId, ownerId, parse.data.articleId);
  const result = await coordinator.proposeChildren(
    worldId, parse.data.articleId, parse.data.userSpec, parse.data.contextDepth, parse.data.contextBasis,
    parse.data.coherenceCheckLevel, parse.data.safetyNet,
  );
  res.json({ proposals: result.proposals });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/summarize  — standalone intro refresh (preview)
// ---------------------------------------------------------------------------

router.post('/summarize', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({
    articleId: z.string().min(1),
    mode:      z.enum(['full', 'improve']).optional().default('full'),
  }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { worldId, ownerId } = requireTenantContext(req);
  await assertArticleUnlocked(worldId, ownerId, parse.data.articleId);
  const result = await coordinator.summarize(worldId, parse.data.articleId, parse.data.mode);
  res.json({ introduction: result.introduction });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/reorganize
// Scribe [reorganize] → Sentinel → Lorekeeper
// ---------------------------------------------------------------------------

router.post('/reorganize', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({
    articleId:    z.string().min(1),
    contextDepth: ContextDepthSchema,
    contextBasis: ContextBasisSchema,
  }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { worldId, ownerId } = requireTenantContext(req);
  const { articleId } = parse.data;
  await assertArticleUnlocked(worldId, ownerId, articleId);
  const sourceRunId = nanoid();
  const result = await coordinator.reorganize(worldId, articleId, parse.data.contextDepth, parse.data.contextBasis);

  // Persist draft so POST /accept can commit it — mirrors /expand's persistence
  // (same table/shape), just without a selectedProposal (reorganize has none).
  const draftContent = { description: result.description, retentionIssues: result.retentionIssues };
  const draft = await savePendingDraft({
    worldId,
    ownerId,
    articleId,
    pipelineType: 'reorganize',
    phase: 'done',
    draftContent,
    sourceRunId,
    runType: 'reorganize',
    contextBasis: parse.data.contextBasis,
    contextDraftIds: result.contextDraftIds ?? [],
    displayTitle: 'Reorganize draft',
  });

  res.json({ ...result, draft });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/cohere  — standalone coherence check
// ---------------------------------------------------------------------------

router.post('/cohere', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({
    articleId:    z.string().min(1),
    contextDepth: ContextDepthSchema,
    contextBasis: ContextBasisSchema,
  }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { worldId, ownerId } = requireTenantContext(req);
  const { articleId } = parse.data;
  await assertArticleUnlocked(worldId, ownerId, articleId);
  const result = await coordinator.cohere(worldId, articleId, parse.data.contextDepth, parse.data.contextBasis);

  // Persist Warden warnings to article_issues, replacing prior Warden results.
  // An empty clean run must still clear stale Warden issues.
  await recordArticleIssues(getDbClient(), {
    worldId,
    ownerId,
    articleId,
    source: 'warden',
    issues: result.warnings.map((w) => ({
      severity: w.severity === 'conflict' ? 'blocking' : 'warning',
      code: 'COHERENCE_WARNING',
      explanation: w.description,
    })),
  });

  res.json({ warnings: result.warnings, suggestedLinks: result.suggestedLinks });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/audit  — Auditor (world-wide coherence scan)
// GET  /api/worlds/:wid/agents/audit/proposals  — list pending edge proposals
// POST /api/worlds/:wid/agents/audit/accept-edge — accept a proposed edge
// ---------------------------------------------------------------------------

router.post('/audit', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({
    sampleSize: z.number().int().min(1).optional(),
    focus: z.enum(['all', 'recent']).optional().default('all'),
  }).safeParse(req.body ?? {});
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { worldId, ownerId } = requireTenantContext(req);
  const result = await coordinator.audit(worldId, parse.data.sampleSize, parse.data.focus);
  const exec = getDbClient();

  // Persist edge proposals for later acceptance
  await recordProposedLinks(exec, { worldId, ownerId, proposals: result.edgeProposals });

  // Persist global warnings to world_issues (replace open ones, preserve dismissed/resolved/in_review)
  await recordWorldIssues(exec, { worldId, ownerId, source: 'auditor', warnings: result.globalWarnings });

  res.json({
    edgeProposals: result.edgeProposals,
    globalWarnings: result.globalWarnings,
  });
}));

router.get('/audit/proposals', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const proposals = await getDbClient().all(
    `SELECT aep.*, sa.title AS source_title, ta.title AS target_title
     FROM auditor_edge_proposals aep
     JOIN articles sa ON sa.id = aep.source_article_id
     JOIN articles ta ON ta.id = aep.target_article_id
     WHERE aep.world_id = ? AND aep.owner_id = ? AND aep.status = 'pending'
     ORDER BY aep.created_at DESC`,
    [worldId, ownerId],
  );
  res.json({ proposals });
}));

router.post('/audit/accept-edge', asyncHandler(async (req, res) => {
  const parse = z.object({
    sourceArticleId: z.string().min(1),
    targetArticleId: z.string().min(1),
    linkType: z.enum(['references', 'hierarchical']),
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parse.error.flatten().fieldErrors });
    return;
  }

  const { worldId, ownerId } = requireTenantContext(req);
  const { sourceArticleId, targetArticleId, linkType } = parse.data;
  const exec = getDbClient();

  const sourceExists = await exec.get<{ current_version_id: string | null }>('SELECT current_version_id FROM articles WHERE id = ? AND world_id = ? AND owner_id = ?', [sourceArticleId, worldId, ownerId]);
  const targetExists = await exec.get<{ current_version_id: string | null }>('SELECT current_version_id FROM articles WHERE id = ? AND world_id = ? AND owner_id = ?', [targetArticleId, worldId, ownerId]);
  if (!sourceExists || !targetExists) {
    res.status(404).json({ error: 'Source or target article not found in this world', code: 'NOT_FOUND' });
    return;
  }

  await exec.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type, source_version_id, target_version_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_article_id, target_article_id) DO NOTHING`,
      [sourceArticleId, targetArticleId, ownerId, linkType, sourceExists.current_version_id, targetExists.current_version_id],
    );

    await tx.run(
      `UPDATE auditor_edge_proposals SET status = 'accepted'
       WHERE world_id = ? AND owner_id = ? AND source_article_id = ? AND target_article_id = ?`,
      [worldId, ownerId, sourceArticleId, targetArticleId],
    );
  });

  res.json({ ok: true });
}));

export default router;
