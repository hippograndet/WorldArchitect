import { Router } from 'express';
import { getDb } from '../db/index.js';
import { buildWorldZip } from '../services/exporter.js';

const router = Router({ mergeParams: true });

// GET /api/worlds/:wid/export
router.get('/', async (req, res) => {
  const { wid } = req.params as Record<string, string>;
  const db = getDb();

  const world = db
    .prepare(`SELECT name FROM worlds WHERE id = ?`)
    .get(wid) as { name: string } | undefined;

  if (!world) {
    res.status(404).json({ error: 'World not found.' });
    return;
  }

  try {
    const buffer = await buildWorldZip(wid);
    const filename = `${world.name.replace(/[^a-z0-9_\-]/gi, '_')}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Export failed.';
    res.status(500).json({ error: msg });
  }
});

export default router;
