import { Router } from 'express';
import { z } from 'zod';
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

const ProposeSchema = z.object({
  articleId: z.string().min(1),
  pipelineType: z.enum(['expand_description', 'create_root', 'create_child']),
  userSpec: z.string().optional(),
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
    );
    res.json({ proposals: result.proposals });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/expand  — Phase 2
// Expander → Summarizer → CoherenceAgent
// ---------------------------------------------------------------------------

const ExpandSchema = z.object({
  articleId: z.string().min(1),
  pipelineType: z.enum(['expand_description', 'create_root', 'create_child', 'reorganize']),
  selectedProposalIndex: z.number().int().min(0).max(2),
  proposals: z.array(z.object({ title: z.string(), direction: z.string() })),
  userSpec: z.string().optional(),
});

router.post('/expand', requireLLM, checkCap, async (req, res) => {
  const parse = ExpandSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { articleId, pipelineType, selectedProposalIndex, proposals, userSpec } = parse.data;
  const selectedProposal = proposals[selectedProposalIndex];
  if (!selectedProposal) {
    res.status(400).json({ error: 'Invalid selectedProposalIndex' });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.expand(worldId, articleId, pipelineType, selectedProposal, userSpec);
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
    articleId: z.string().min(1),
    userSpec: z.string().optional(),
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.proposeChildren(worldId, parse.data.articleId, parse.data.userSpec);
    res.json({ proposals: result.proposals });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/summarize  — standalone intro refresh (preview)
// ---------------------------------------------------------------------------

router.post('/summarize', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({ articleId: z.string().min(1) }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.summarize(worldId, parse.data.articleId);
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
  const parse = z.object({ articleId: z.string().min(1) }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.reorganize(worldId, parse.data.articleId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/agents/cohere  — standalone coherence check
// ---------------------------------------------------------------------------

router.post('/cohere', requireLLM, checkCap, async (req, res) => {
  const parse = z.object({ articleId: z.string().min(1) }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.cohere(worldId, parse.data.articleId);
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
    articleId: z.string().min(1),
    userSpec: z.string().optional(),
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const worldId = wid(req);
  try {
    const director = new PipelineCoordinator();
    const result = await director.expandChronology(worldId, parse.data.articleId, parse.data.userSpec);
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
// BibleCompressor (preview only — no DB writes)
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

export default router;
