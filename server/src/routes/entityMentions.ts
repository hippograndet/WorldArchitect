import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';

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

router.get('/', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const status = (req.query as Record<string, string>).status ?? null;

  const db = getDb();
  let rows: DbRow[];
  if (status) {
    rows = db.prepare(
      `SELECT * FROM entity_mentions WHERE world_id = ? AND status = ? ORDER BY created_at DESC`,
    ).all(wid, status) as DbRow[];
  } else {
    rows = db.prepare(
      `SELECT * FROM entity_mentions WHERE world_id = ? ORDER BY created_at DESC`,
    ).all(wid) as DbRow[];
  }

  res.json(rows.map(parseMention));
});

// ---------------------------------------------------------------------------
// PATCH /api/worlds/:wid/entity-mentions/:mid
// ---------------------------------------------------------------------------

const PatchSchema = z.object({
  status: z.enum(['created', 'ignored']),
});

router.patch('/:mid', (req, res) => {
  const parse = PatchSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const wid = (req.params as Record<string, string>).wid;
  const mid = (req.params as Record<string, string>).mid;
  const db = getDb();

  const existing = db.prepare(
    `SELECT id FROM entity_mentions WHERE id = ? AND world_id = ?`,
  ).get(mid, wid);

  if (!existing) {
    res.status(404).json({ error: 'Entity mention not found' });
    return;
  }

  db.prepare(`UPDATE entity_mentions SET status = ? WHERE id = ?`).run(parse.data.status, mid);

  const updated = db.prepare(`SELECT * FROM entity_mentions WHERE id = ?`).get(mid) as DbRow;
  res.json(parseMention(updated));
});

export default router;
