import { Router } from 'express';
import { getDbClient } from '../db/client.js';
import { buildWorldZip } from '../services/exporter.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';

const router = Router({ mergeParams: true });

// GET /api/worlds/:wid/export
router.get('/', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);

  const world = await getDbClient().get<{ name: string }>(`SELECT name FROM worlds WHERE id = ? AND owner_id = ?`, [worldId, ownerId]);

  if (!world) {
    res.status(404).json({ error: 'World not found.' });
    return;
  }

  try {
    const buffer = await buildWorldZip(worldId, { worldId, ownerId });
    const filename = `${world.name.replace(/[^a-z0-9_\-]/gi, '_')}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Export failed.';
    res.status(500).json({ error: msg });
  }
}));

export default router;
