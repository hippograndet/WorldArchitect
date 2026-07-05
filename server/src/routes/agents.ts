import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireLLM, isLLMConfigured, getProvider } from '../providers/index.js';
import { renderBible, getBibleMeta } from '../services/worldBible.js';
import { checkDailyCap } from '../services/callLogger.js';
import { PipelineCoordinator } from '../agents/director.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { getDbClient } from '../db/client.js';
import { tenantIdFor } from '../tenant.js';
import { recordArticleIssues, recordWorldIssues, recordProposedLinks } from '../services/issueRecorder.js';
import { assertArticleUnlocked } from '../services/runsService.js';
import type { Request, Response, NextFunction } from 'express';

const router = Router({ mergeParams: true });

// Module-level singleton — PipelineCoordinator has no per-request state
const coordinator = new PipelineCoordinator();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wid(req: Request): string {
  return (req.params as Record<string, string>).wid;
}

// ---------------------------------------------------------------------------
// Middleware: daily cap check
// ---------------------------------------------------------------------------

const checkCap = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { allowed, current, cap } = await checkDailyCap(wid(req));
  if (!allowed) {
    res.status(429).json({ error: `Daily call cap reached (${current}/${cap}).`, code: 'DAILY_CAP' });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/estimate
// ---------------------------------------------------------------------------

router.post('/estimate', asyncHandler(async (req, res) => {
  const parse = z.object({ extraText: z.string().optional() }).safeParse(req.body ?? {});
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const worldId = wid(req);
  const bibleText = await renderBible(worldId);
  const combined = parse.data.extraText ? `${bibleText}\n\n${parse.data.extraText}` : bibleText;

  let estimatedTokens: number;
  try {
    estimatedTokens = (await isLLMConfigured())
      ? await (await getProvider()).estimateTokens(combined)
      : Math.ceil(combined.length / 4);
  } catch {
    estimatedTokens = Math.ceil(combined.length / 4);
  }

  res.json({ estimatedTokens });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/skeleton
// ---------------------------------------------------------------------------

router.post('/skeleton', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({ seedText: z.string().min(1) }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const worldId = wid(req);
  const world = await getDbClient().get('SELECT id FROM worlds WHERE id = ?', [worldId]);
  if (!world) throw new AppError(404, 'NOT_FOUND', 'World not found');

  const result = await coordinator.createWorld(worldId, parse.data.seedText);
  const { tokenCount } = await getBibleMeta(worldId);
  res.json({ stubs: result.stubs, worldBibleTokenCount: tokenCount });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/propose  — Phase 1
// Returns 3 creative direction proposals for the user to choose from.
// ---------------------------------------------------------------------------

const ContextDepthSchema = z.enum(['shallow', 'mid', 'deep']).optional().default('mid');

const ProposeSchema = z.object({
  articleId:    z.string().min(1),
  pipelineType: z.enum(['expand_description', 'create_root', 'create_child']),
  userSpec:     z.string().optional(),
  autoSelect:   z.boolean().optional().default(false),
  contextDepth: ContextDepthSchema,
});

router.post('/propose', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = ProposeSchema.safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const worldId = wid(req);
  await assertArticleUnlocked(worldId, parse.data.articleId);
  const result = await coordinator.propose(
    worldId,
    parse.data.articleId,
    parse.data.pipelineType,
    parse.data.userSpec,
    parse.data.autoSelect,
    parse.data.contextDepth,
  );
  res.json({
    proposals: result.proposals,
    ...(result.autoSelectedIndex !== undefined
      ? { autoSelectedIndex: result.autoSelectedIndex, autoSelectRationale: result.autoSelectRationale }
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
  selectedProposalIndex:  z.number().int().min(0).max(4),
  proposals:              z.array(z.object({ title: z.string(), direction: z.string() })).max(5),
  selectedIdeas:          z.array(z.object({ id: z.string(), theme: z.string(), detail: z.string() })).optional(),
  userSpec:               z.string().optional(),
  contextDepth:           ContextDepthSchema,
  runStyleWarden:         z.boolean().optional().default(false),
  runContinuityEditor:    z.boolean().optional().default(false),
  wordCountPreset:        z.enum(['short', 'medium', 'long']).optional().default('medium'),
});

router.post('/expand', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = ExpandSchema.safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const { articleId, pipelineType, selectedProposalIndex, proposals, selectedIdeas, userSpec, contextDepth, runStyleWarden, runContinuityEditor, wordCountPreset } = parse.data;
  const selectedProposal = proposals[selectedProposalIndex];
  if (!selectedProposal) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid selectedProposalIndex');

  const worldId = wid(req);
  await assertArticleUnlocked(worldId, articleId);
  const result = await coordinator.expand(worldId, articleId, pipelineType, selectedProposal, userSpec, contextDepth, selectedIdeas, runStyleWarden, runContinuityEditor, wordCountPreset);

  // Persist draft so POST /accept can commit it
  const exec = getDbClient();
  const draftContent = pipelineType === 'create_child'
    ? { childDescription: result.description, introduction: result.introduction, mentions: result.mentions }
    : { description: result.description, mentions: result.mentions };

  const parentUpdateJson = result.parentUpdate
    ? JSON.stringify({ articleId, appendText: result.parentUpdate.appendText })
    : null;

  const now = Date.now();
  const existing = await exec.get('SELECT id FROM pending_drafts WHERE article_id = ? AND pipeline_type = ?', [articleId, pipelineType]);
  if (existing) {
    await exec.run(
      `UPDATE pending_drafts
       SET draft_content = ?, parent_update = ?, selected_proposal = ?, updated_at = ?
       WHERE article_id = ? AND pipeline_type = ?`,
      [JSON.stringify(draftContent), parentUpdateJson, JSON.stringify(selectedProposal), now, articleId, pipelineType],
    );
  } else {
    await exec.run(
      `INSERT INTO pending_drafts
         (id, owner_id, article_id, draft_content, pipeline_type, parent_update, selected_proposal, expansion_params, phase, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'done', ?, ?)`,
      [nanoid(), tenantIdFor(req), articleId, JSON.stringify(draftContent), pipelineType, parentUpdateJson, JSON.stringify(selectedProposal), now, now],
    );
  }

  res.json(result);
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/propose-children
// Cartographer — proposes 10 child stubs from existing description
// ---------------------------------------------------------------------------

router.post('/propose-children', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({
    articleId:    z.string().min(1),
    userSpec:     z.string().optional(),
    contextDepth: ContextDepthSchema,
  }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const worldId = wid(req);
  await assertArticleUnlocked(worldId, parse.data.articleId);
  const result = await coordinator.proposeChildren(worldId, parse.data.articleId, parse.data.userSpec, parse.data.contextDepth);
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

  const worldId = wid(req);
  await assertArticleUnlocked(worldId, parse.data.articleId);
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
  }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const worldId = wid(req);
  await assertArticleUnlocked(worldId, parse.data.articleId);
  const result = await coordinator.reorganize(worldId, parse.data.articleId, parse.data.contextDepth);
  res.json(result);
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/cohere  — standalone coherence check
// ---------------------------------------------------------------------------

router.post('/cohere', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({
    articleId:    z.string().min(1),
    contextDepth: ContextDepthSchema,
  }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const worldId = wid(req);
  const { articleId } = parse.data;
  await assertArticleUnlocked(worldId, articleId);
  const result = await coordinator.cohere(worldId, articleId, parse.data.contextDepth);

  // Persist Warden warnings to article_issues (replacing previous warden issues for this article)
  if (result.warnings.length > 0) {
    await recordArticleIssues(getDbClient(), {
      worldId,
      ownerId: tenantIdFor(req),
      articleId,
      source: 'warden',
      issues: result.warnings.map((w) => ({
        severity: w.severity === 'conflict' ? 'blocking' : 'warning',
        code: 'COHERENCE_WARNING',
        explanation: w.description,
      })),
    });
  }

  res.json({ warnings: result.warnings, suggestedLinks: result.suggestedLinks });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/chronology
// Chronicler → Warden
// ---------------------------------------------------------------------------

router.post('/chronology', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({
    articleId:    z.string().min(1),
    userSpec:     z.string().optional(),
    contextDepth: ContextDepthSchema,
  }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const worldId = wid(req);
  await assertArticleUnlocked(worldId, parse.data.articleId);
  const result = await coordinator.expandChronology(worldId, parse.data.articleId, parse.data.userSpec, parse.data.contextDepth);
  res.json({
    chronologySection: result.chronologySection,
    coherenceWarnings: result.coherenceWarnings,
    suggestedLinks: result.suggestedLinks,
  });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/compress
// Condenser (preview only — no DB writes)
// ---------------------------------------------------------------------------

router.post('/compress', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const worldId = wid(req);
  const result = await coordinator.compress(worldId);
  res.json({ entries: result.entries });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/propose-ideas  — Oracle (Step B idea selection)
// ---------------------------------------------------------------------------

router.post('/propose-ideas', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = z.object({
    articleId:        z.string().min(1),
    introduction:     z.string().min(1),
    selectedProposal: z.object({ title: z.string(), direction: z.string() }),
    userSpec:         z.string().optional(),
    contextDepth:     ContextDepthSchema,
  }).safeParse(req.body);
  if (!parse.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', parse.error.flatten().fieldErrors);

  const worldId = wid(req);
  await assertArticleUnlocked(worldId, parse.data.articleId);
  const result = await coordinator.proposeIdeas(
    worldId,
    parse.data.articleId,
    parse.data.introduction,
    parse.data.selectedProposal,
    parse.data.userSpec,
    parse.data.contextDepth,
  );
  res.json({ ideas: result.ideas });
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

  const worldId = wid(req);
  const ownerId = tenantIdFor(req);
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
  const worldId = wid(req);
  const proposals = await getDbClient().all(
    `SELECT aep.*, sa.title AS source_title, ta.title AS target_title
     FROM auditor_edge_proposals aep
     JOIN articles sa ON sa.id = aep.source_article_id
     JOIN articles ta ON ta.id = aep.target_article_id
     WHERE aep.world_id = ? AND aep.status = 'pending'
     ORDER BY aep.created_at DESC`,
    [worldId],
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

  const worldId = wid(req);
  const { sourceArticleId, targetArticleId, linkType } = parse.data;
  const exec = getDbClient();

  const sourceExists = await exec.get('SELECT id FROM articles WHERE id = ? AND world_id = ?', [sourceArticleId, worldId]);
  const targetExists = await exec.get('SELECT id FROM articles WHERE id = ? AND world_id = ?', [targetArticleId, worldId]);
  if (!sourceExists || !targetExists) {
    res.status(404).json({ error: 'Source or target article not found in this world', code: 'NOT_FOUND' });
    return;
  }

  await exec.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (source_article_id, target_article_id) DO NOTHING`,
      [sourceArticleId, targetArticleId, tenantIdFor(req), linkType],
    );

    await tx.run(
      `UPDATE auditor_edge_proposals SET status = 'accepted'
       WHERE world_id = ? AND source_article_id = ? AND target_article_id = ?`,
      [worldId, sourceArticleId, targetArticleId],
    );
  });

  res.json({ ok: true });
}));

export default router;
