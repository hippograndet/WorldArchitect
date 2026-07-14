import { Router } from 'express';
import { renderBible, getBibleMeta } from '../services/worldBible.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';

const router = Router({ mergeParams: true });

// GET /api/worlds/:wid/bible — returns token metadata (no UI editor)
router.get('/', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  res.json(await getBibleMeta(worldId, ownerId));
}));

// GET /api/worlds/:wid/bible/render — full rendered markdown for LLM context preview
router.get('/render', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const markdown = await renderBible(worldId, ownerId);
  res.json({ markdown, ...(await getBibleMeta(worldId, ownerId)) });
}));

export default router;
