import { Router } from 'express';
import { z } from 'zod';
import { renderBible, upsertEntry, getBibleMeta } from '../services/worldBible.js';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';

const router = Router({ mergeParams: true });

// GET /api/worlds/:wid/bible — returns token metadata (no UI editor)
router.get('/', asyncHandler(async (req, res) => {
  const { worldId } = requireTenantContext(req);
  res.json(await getBibleMeta(worldId));
}));

// GET /api/worlds/:wid/bible/render — full rendered markdown for LLM context preview
router.get('/render', asyncHandler(async (req, res) => {
  const { worldId } = requireTenantContext(req);
  const markdown = await renderBible(worldId);
  res.json({ markdown, ...(await getBibleMeta(worldId)) });
}));

// PATCH /api/worlds/:wid/bible/:aid — update one article's summary (called by agent accept flow)
const UpdateEntrySchema = z.object({ summary: z.string().min(1) });

router.patch('/:aid', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const parse = UpdateEntrySchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten().fieldErrors }); return; }

  const article = await getDbClient().get('SELECT id FROM articles WHERE id = ? AND world_id = ? AND owner_id = ?', [(req.params as Record<string, string>).aid, worldId, ownerId]);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  await upsertEntry(getDbClient(), worldId, (req.params as Record<string, string>).aid, parse.data.summary);
  res.json(await getBibleMeta(worldId));
}));

export default router;
