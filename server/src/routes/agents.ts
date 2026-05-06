import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Request, Response, NextFunction } from 'express';
import { requireLLM, isLLMConfigured, getProvider } from '../providers/index.js';
import { renderBible, getBibleMeta } from '../services/worldBible.js';
import { checkDailyCap } from '../services/callLogger.js';
import { PipelineCoordinator } from '../agents/director.js';
import { getDb } from '../db/index.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wid(req: Request): string {
  return (req.params as Record<string, string>).wid;
}

// ---------------------------------------------------------------------------
// Middleware: daily cap check
// ---------------------------------------------------------------------------

function checkCap(req: Request, res: Response, next: NextFunction): void {
  const { allowed, current, cap } = checkDailyCap(wid(req));
  if (!allowed) {
    res.status(429).json({ error: `Daily call cap reached (${current}/${cap}).` });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/estimate
// ---------------------------------------------------------------------------

router.post('/estimate', async (req, res) => {
  const parse = z.object({ extraText: z.string().optional() }).safeParse(req.body ?? {});
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  const bibleText = renderBible(worldId);
  const combined = parse.data.extraText ? `${bibleText}\n\n${parse.data.extraText}` : bibleText;

  let estimatedTokens: number;
  try {
    estimatedTokens = isLLMConfigured()
      ? await getProvider().estimateTokens(combined)
      : Math.ceil(combined.length / 4);
  } catch {
    estimatedTokens = Math.ceil(combined.length / 4);
  }

  res.json({ estimatedTokens });
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/skeleton
// ---------------------------------------------------------------------------

router.post('/skeleton', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({ seedText: z.string().min(1) }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  const world = getDb().prepare('SELECT id FROM worlds WHERE id = ?').get(worldId);
  if (!world) { res.status(404).json({ error: 'World not found' }); return; }

  try {
    const director = new PipelineCoordinator();
    const result = await director.createWorld(worldId, parse.data.seedText);
    const { tokenCount } = getBibleMeta(worldId);
    res.json({ stubs: result.stubs, worldBibleTokenCount: tokenCount });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

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

router.post('/propose', requireLLM, checkCap, async (req, res) => {
  const parse = ProposeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.propose(
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
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/expand  — Phase 2
// Expander → Summarizer → CoherenceAgent
// ---------------------------------------------------------------------------

const ExpandSchema = z.object({
  articleId:             z.string().min(1),
  pipelineType:          z.enum(['expand_description', 'create_root', 'create_child', 'reorganize']),
  selectedProposalIndex: z.number().int().min(0).max(4),
  proposals:             z.array(z.object({ title: z.string(), direction: z.string() })).max(5),
  selectedIdeas:         z.array(z.object({ id: z.string(), theme: z.string(), detail: z.string() })).optional(),
  userSpec:              z.string().optional(),
  contextDepth:          ContextDepthSchema,
  runStyleWarden:        z.boolean().optional().default(false),
});

router.post('/expand', requireLLM, checkCap, async (req, res) => {
  const parse = ExpandSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { articleId, pipelineType, selectedProposalIndex, proposals, selectedIdeas, userSpec, contextDepth, runStyleWarden } = parse.data;
  const selectedProposal = proposals[selectedProposalIndex];
  if (!selectedProposal) {
    res.status(400).json({ error: 'Invalid selectedProposalIndex' });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.expand(worldId, articleId, pipelineType, selectedProposal, userSpec, contextDepth, selectedIdeas, runStyleWarden);

    // Persist draft so POST /accept can commit it
    const db = getDb();
    const draftContent = pipelineType === 'create_child'
      ? { childDescription: result.description, introduction: result.introduction }
      : { description: result.description };

    const parentUpdateJson = result.parentUpdate
      ? JSON.stringify({ articleId, appendText: result.parentUpdate.appendText })
      : null;

    const now = Date.now();
    const existing = db.prepare('SELECT id FROM pending_drafts WHERE article_id = ?').get(articleId);
    if (existing) {
      db.prepare(
        `UPDATE pending_drafts
         SET draft_content = ?, pipeline_type = ?, parent_update = ?, selected_proposal = ?, updated_at = ?
         WHERE article_id = ?`,
      ).run(JSON.stringify(draftContent), pipelineType, parentUpdateJson, JSON.stringify(selectedProposal), now, articleId);
    } else {
      db.prepare(
        `INSERT INTO pending_drafts
           (id, article_id, draft_content, pipeline_type, parent_update, selected_proposal, expansion_params, phase, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '{}', 'done', ?, ?)`,
      ).run(nanoid(), articleId, JSON.stringify(draftContent), pipelineType, parentUpdateJson, JSON.stringify(selectedProposal), now, now);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/propose-children
// ChildProposer — proposes 10 child stubs from existing description
// ---------------------------------------------------------------------------

router.post('/propose-children', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({
    articleId:    z.string().min(1),
    userSpec:     z.string().optional(),
    contextDepth: ContextDepthSchema,
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.proposeChildren(worldId, parse.data.articleId, parse.data.userSpec, parse.data.contextDepth);
    res.json({ proposals: result.proposals });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/summarize  — standalone intro refresh (preview)
// ---------------------------------------------------------------------------

router.post('/summarize', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({
    articleId: z.string().min(1),
    mode:      z.enum(['full', 'improve']).optional().default('full'),
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.summarize(worldId, parse.data.articleId, parse.data.mode);
    res.json({ introduction: result.introduction });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/reorganize
// Expander [reorganize] → RetentionAgent → Summarizer
// ---------------------------------------------------------------------------

router.post('/reorganize', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({
    articleId:    z.string().min(1),
    contextDepth: ContextDepthSchema,
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.reorganize(worldId, parse.data.articleId, parse.data.contextDepth);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/cohere  — standalone coherence check
// ---------------------------------------------------------------------------

router.post('/cohere', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({
    articleId:    z.string().min(1),
    contextDepth: ContextDepthSchema,
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.cohere(worldId, parse.data.articleId, parse.data.contextDepth);
    res.json({ warnings: result.warnings, suggestedLinks: result.suggestedLinks });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/chronology  — Block 8
// Chronicler → CoherenceAgent
// ---------------------------------------------------------------------------

router.post('/chronology', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({
    articleId:    z.string().min(1),
    userSpec:     z.string().optional(),
    contextDepth: ContextDepthSchema,
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.expandChronology(worldId, parse.data.articleId, parse.data.userSpec, parse.data.contextDepth);
    res.json({
      chronologySection: result.chronologySection,
      coherenceWarnings: result.coherenceWarnings,
      suggestedLinks: result.suggestedLinks,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/compress  — Block 8
// Condenser (preview only — no DB writes)
// ---------------------------------------------------------------------------

router.post('/compress', requireLLM, checkCap, async (req, res) => {
  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.compress(worldId);
    res.json({ entries: result.entries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/propose-ideas  — Oracle (Step B idea selection)
// ---------------------------------------------------------------------------

router.post('/propose-ideas', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({
    articleId:        z.string().min(1),
    introduction:     z.string().min(1),
    selectedProposal: z.object({ title: z.string(), direction: z.string() }),
    userSpec:         z.string().optional(),
    contextDepth:     ContextDepthSchema,
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.proposeIdeas(
      worldId,
      parse.data.articleId,
      parse.data.introduction,
      parse.data.selectedProposal,
      parse.data.userSpec,
      parse.data.contextDepth,
    );
    res.json({ ideas: result.ideas });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/audit  — Auditor (world-wide coherence scan)
// GET  /api/worlds/:wid/agents/audit/proposals  — list pending edge proposals
// POST /api/worlds/:wid/agents/audit/accept-edge — accept a proposed edge
// ---------------------------------------------------------------------------

router.post('/audit', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({ sampleSize: z.number().int().min(1).optional() }).safeParse(req.body ?? {});
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.audit(worldId, parse.data.sampleSize);

    // Persist edge proposals for later acceptance
    const db = getDb();
    const now = Date.now();
    for (const ep of result.edgeProposals) {
      const sourceExists = db.prepare('SELECT id FROM articles WHERE id = ? AND world_id = ?').get(ep.sourceArticleId, worldId);
      const targetExists = db.prepare('SELECT id FROM articles WHERE id = ? AND world_id = ?').get(ep.targetArticleId, worldId);
      if (!sourceExists || !targetExists) continue;

      db.prepare(
        `INSERT OR IGNORE INTO auditor_edge_proposals
           (id, world_id, source_article_id, target_article_id, link_type, rationale, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(nanoid(), worldId, ep.sourceArticleId, ep.targetArticleId, ep.linkType, ep.rationale, now);
    }

    res.json({
      edgeProposals: result.edgeProposals,
      globalWarnings: result.globalWarnings,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/audit/proposals', (req, res) => {
  const worldId = wid(req);
  const db = getDb();
  const proposals = db.prepare(
    `SELECT aep.*, sa.title AS source_title, ta.title AS target_title
     FROM auditor_edge_proposals aep
     JOIN articles sa ON sa.id = aep.source_article_id
     JOIN articles ta ON ta.id = aep.target_article_id
     WHERE aep.world_id = ? AND aep.status = 'pending'
     ORDER BY aep.created_at DESC`,
  ).all(worldId);
  res.json({ proposals });
});

router.post('/audit/accept-edge', (req, res) => {
  const parse = z.object({
    sourceArticleId: z.string().min(1),
    targetArticleId: z.string().min(1),
    linkType: z.enum(['references', 'hierarchical']),
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  const { sourceArticleId, targetArticleId, linkType } = parse.data;
  const db = getDb();

  const sourceExists = db.prepare('SELECT id FROM articles WHERE id = ? AND world_id = ?').get(sourceArticleId, worldId);
  const targetExists = db.prepare('SELECT id FROM articles WHERE id = ? AND world_id = ?').get(targetArticleId, worldId);
  if (!sourceExists || !targetExists) {
    res.status(404).json({ error: 'Source or target article not found in this world' });
    return;
  }

  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO article_links (source_article_id, target_article_id, link_type)
       VALUES (?, ?, ?)`,
    ).run(sourceArticleId, targetArticleId, linkType);

    db.prepare(
      `UPDATE auditor_edge_proposals SET status = 'accepted'
       WHERE world_id = ? AND source_article_id = ? AND target_article_id = ?`,
    ).run(worldId, sourceArticleId, targetArticleId);
  })();

  res.json({ ok: true });
});

export default router;
