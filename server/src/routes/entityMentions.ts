import { Router } from 'express';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';

const router = Router({ mergeParams: true });

type DbRow = Record<string, unknown>;

function parseMention(row: DbRow) {
  return {
    id: row.id as string,
    worldId: row.world_id as string,
    sourceArticleId: row.source_article_id as string,
    articleId: (row.article_id as string | null) ?? null,
    title: row.title as string,
    templateType: row.template_type as string,
    summary: (row.summary as string | null) ?? null,
    status: row.status as string,
    createdAt: row.created_at as number,
  };
}

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

  res.json(rows.map(parseMention));
}));

// ---------------------------------------------------------------------------
// PATCH /api/worlds/:wid/entity-mentions/:mid
// ---------------------------------------------------------------------------

const PatchSchema = z.object({
  status: z.enum(['created', 'ignored']),
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
  res.json(parseMention(updated!));
}));

export default router;
