import { Router } from 'express';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';
import { requireLLM } from '../providers/index.js';
import { checkDailyCap } from '../services/callLogger.js';
import { acceptEntityMention, EntityMentionServiceError, parseEntityMention, scanEntityMentions } from '../services/entityMentionService.js';
import type { Request, Response, NextFunction } from 'express';

const router = Router({ mergeParams: true });

type DbRow = Record<string, unknown>;

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
// GET /api/worlds/:wid/entity-mentions
// ---------------------------------------------------------------------------

router.get('/', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const status = (req.query as Record<string, string>).status ?? null;

  const db = getDbClient();
  const rows = status
    ? await db.all<DbRow>(
        `SELECT * FROM entity_mentions WHERE world_id = ? AND owner_id = ? AND status = ? ORDER BY created_at DESC`,
        [worldId, ownerId, status],
      )
    : await db.all<DbRow>(
        `SELECT * FROM entity_mentions WHERE world_id = ? AND owner_id = ? ORDER BY created_at DESC`,
        [worldId, ownerId],
      );

  res.json(rows.map(parseEntityMention));
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/entity-mentions/scan
// ---------------------------------------------------------------------------

const ScanSchema = z.object({
  articleId: z.string().min(1).optional(),
});

router.post('/scan', requireLLM, checkCap, asyncHandler(async (req, res) => {
  const parse = ScanSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { worldId, ownerId } = requireTenantContext(req);
  try {
    res.json(await scanEntityMentions({ worldId, ownerId, articleId: parse.data.articleId }));
  } catch (err) {
    if (err instanceof EntityMentionServiceError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/entity-mentions/:mid/accept
// ---------------------------------------------------------------------------

router.post('/:mid/accept', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  try {
    res.json(await acceptEntityMention({
      worldId,
      ownerId,
      mentionId: (req.params as Record<string, string>).mid,
    }));
  } catch (err) {
    if (err instanceof EntityMentionServiceError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// PATCH /api/worlds/:wid/entity-mentions/:mid
// ---------------------------------------------------------------------------

const PatchSchema = z.object({
  status: z.enum(['ignored']),
});

router.patch('/:mid', asyncHandler(async (req, res) => {
  const parse = PatchSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { worldId, ownerId } = requireTenantContext(req);
  const mid = (req.params as Record<string, string>).mid;
  const db = getDbClient();

  const existing = await db.get(
    `SELECT id FROM entity_mentions WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [mid, worldId, ownerId],
  );

  if (!existing) {
    res.status(404).json({ error: 'Entity mention not found' });
    return;
  }

  await db.run(`UPDATE entity_mentions SET status = ? WHERE id = ? AND owner_id = ?`, [parse.data.status, mid, ownerId]);

  const updated = await db.get<DbRow>(`SELECT * FROM entity_mentions WHERE id = ? AND owner_id = ?`, [mid, ownerId]);
  res.json(parseEntityMention(updated!));
}));

export default router;
