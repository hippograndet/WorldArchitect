import { Router } from 'express';
import { z } from 'zod';
import { renderBible, upsertEntry, getBibleMeta } from '../services/worldBible.js';
import { getDb } from '../db/index.js';

const router = Router({ mergeParams: true });

function requireWorld(worldId: string): boolean {
  return !!getDb().prepare('SELECT id FROM worlds WHERE id = ?').get(worldId);
}

// GET /api/worlds/:wid/bible — returns token metadata (no UI editor)
router.get('/', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  if (!requireWorld(wid)) { res.status(404).json({ error: 'World not found' }); return; }
  res.json(getBibleMeta(wid));
});

// GET /api/worlds/:wid/bible/render — full rendered markdown for LLM context preview
router.get('/render', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  if (!requireWorld(wid)) { res.status(404).json({ error: 'World not found' }); return; }
  const markdown = renderBible(wid);
  res.json({ markdown, ...getBibleMeta(wid) });
});

// PATCH /api/worlds/:wid/bible/:aid — update one article's summary (called by agent accept flow)
const UpdateEntrySchema = z.object({ summary: z.string().min(1) });

router.patch('/:aid', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const parse = UpdateEntrySchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten().fieldErrors }); return; }
  if (!requireWorld(wid)) { res.status(404).json({ error: 'World not found' }); return; }

  const db = getDb();
  const article = db.prepare('SELECT id FROM articles WHERE id = ? AND world_id = ?').get(req.params.aid, wid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  upsertEntry(wid, req.params.aid, parse.data.summary);
  res.json(getBibleMeta(wid));
});

export default router;
