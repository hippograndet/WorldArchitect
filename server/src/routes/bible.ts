import { Router } from 'express';
import { z } from 'zod';
import {
  getEntries,
  renderBible,
  upsertEntry,
  getBibleMeta,
} from '../services/worldBible.js';
import { getDb } from '../db/index.js';

const router = Router({ mergeParams: true });

const UpdateEntrySchema = z.object({
  summary: z.string().min(1),
});

function requireWorld(worldId: string): boolean {
  return !!getDb().prepare('SELECT id FROM worlds WHERE id = ?').get(worldId);
}

// GET /api/worlds/:wid/bible
// Returns all per-article entries (for the Bible editor UI) + token metadata.
router.get('/', (req, res) => {
  if (!requireWorld(req.params.wid)) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const entries = getEntries(req.params.wid);
  const meta = getBibleMeta(req.params.wid);

  res.json({ entries, ...meta });
});

// GET /api/worlds/:wid/bible/render
// Returns the full rendered markdown string (what agents receive as context).
// Must be declared before /:aid to avoid 'render' being treated as an article ID.
router.get('/render', (req, res) => {
  if (!requireWorld(req.params.wid)) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const markdown = renderBible(req.params.wid);
  const meta = getBibleMeta(req.params.wid);

  res.json({ markdown, ...meta });
});

// PATCH /api/worlds/:wid/bible/:aid
// Manually edit one article's World Bible summary.
router.patch('/:aid', (req, res) => {
  const parse = UpdateEntrySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  if (!requireWorld(req.params.wid)) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const db = getDb();
  const article = db
    .prepare('SELECT id FROM articles WHERE id = ? AND world_id = ?')
    .get(req.params.aid, req.params.wid);

  if (!article) {
    res.status(404).json({ error: 'Article not found' });
    return;
  }

  upsertEntry(req.params.wid, req.params.aid, parse.data.summary);

  const entries = getEntries(req.params.wid);
  const updated = entries.find((e) => e.articleId === req.params.aid);
  const meta = getBibleMeta(req.params.wid);

  res.json({ entry: updated ?? null, ...meta });
});

export default router;
