import { Router } from 'express';
import { z } from 'zod';
import { renderBible, upsertEntry, getBibleMeta } from '../services/worldBible.js';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router({ mergeParams: true });

async function requireWorld(worldId: string): Promise<boolean> {
  const row = await getDbClient().get('SELECT id FROM worlds WHERE id = ?', [worldId]);
  return !!row;
}

// GET /api/worlds/:wid/bible — returns token metadata (no UI editor)
router.get('/', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  if (!(await requireWorld(wid))) { res.status(404).json({ error: 'World not found' }); return; }
  res.json(await getBibleMeta(wid));
}));

// GET /api/worlds/:wid/bible/render — full rendered markdown for LLM context preview
router.get('/render', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  if (!(await requireWorld(wid))) { res.status(404).json({ error: 'World not found' }); return; }
  const markdown = await renderBible(wid);
  res.json({ markdown, ...(await getBibleMeta(wid)) });
}));

// PATCH /api/worlds/:wid/bible/:aid — update one article's summary (called by agent accept flow)
const UpdateEntrySchema = z.object({ summary: z.string().min(1) });

router.patch('/:aid', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const parse = UpdateEntrySchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten().fieldErrors }); return; }
  if (!(await requireWorld(wid))) { res.status(404).json({ error: 'World not found' }); return; }

  const article = await getDbClient().get('SELECT id FROM articles WHERE id = ? AND world_id = ?', [(req.params as Record<string, string>).aid, wid]);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  await upsertEntry(getDbClient(), wid, (req.params as Record<string, string>).aid, parse.data.summary);
  res.json(await getBibleMeta(wid));
}));

export default router;
