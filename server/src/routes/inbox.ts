import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';
import { countInboxItems, listInboxItems } from '../services/inboxService.js';

const router = Router({ mergeParams: true });

router.get('/', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  res.json({ items: await listInboxItems(worldId, ownerId) });
}));

router.get('/count', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  res.json(await countInboxItems(worldId, ownerId));
}));

export default router;
