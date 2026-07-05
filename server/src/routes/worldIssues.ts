import { Router } from 'express';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { tenantIdFor } from '../tenant.js';

const router = Router({ mergeParams: true });

router.get('/issues', asyncHandler(async (req, res) => {
  const wid = req.params.wid;

  const summary = await getDbClient().all<{ severity: string; count: number }>(`
    SELECT severity, COUNT(*) AS count
    FROM article_issues
    WHERE world_id = ? AND owner_id = ? AND status = 'open'
    GROUP BY severity
  `, [wid, tenantIdFor(req)]);

  const blocking = summary.find(s => s.severity === 'blocking')?.count ?? 0;
  const warnings = summary.find(s => s.severity === 'warning')?.count ?? 0;

  res.json({ blocking, warnings, total: blocking + warnings });
}));

router.get('/world-issues', asyncHandler(async (req, res) => {
  const worldId = req.params.wid;
  const { status, severity, type } = req.query as Record<string, string | undefined>;

  let sql = `SELECT * FROM world_issues WHERE world_id = ? AND owner_id = ?`;
  const params: unknown[] = [worldId, tenantIdFor(req)];

  if (status) { sql += ` AND status = ?`; params.push(status); }
  if (severity) { sql += ` AND severity = ?`; params.push(severity); }
  if (type) { sql += ` AND type = ?`; params.push(type); }
  sql += ` ORDER BY created_at DESC`;

  const rows = await getDbClient().all<Record<string, unknown>>(sql, params);
  res.json(rows.map(parseWorldIssue));
}));

router.patch('/world-issues/:iid', asyncHandler(async (req, res) => {
  const parse = z.object({
    status: z.enum(['open', 'in_review', 'resolved', 'dismissed']),
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid status', code: 'VALIDATION_ERROR' });
    return;
  }

  const { wid, iid } = req.params;
  const now = Date.now();
  const result = await getDbClient().run(
    `UPDATE world_issues SET status = ?, updated_at = ? WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [parse.data.status, now, iid, wid, tenantIdFor(req)],
  );

  if (result.changes === 0) {
    res.status(404).json({ error: 'Issue not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ ok: true });
}));

router.get('/articles/:aid/world-issues', asyncHandler(async (req, res) => {
  const { wid, aid } = req.params;

  const rows = await getDbClient().all<Record<string, unknown>>(
    `SELECT * FROM world_issues WHERE world_id = ? AND owner_id = ? AND status != 'dismissed' AND article_ids LIKE ? ORDER BY created_at DESC`,
    [wid, tenantIdFor(req), `%"${aid}"%`],
  );

  res.json(rows.map(parseWorldIssue));
}));

function parseWorldIssue(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id,
    worldId: r.world_id,
    severity: r.severity,
    type: r.type,
    description: r.description,
    articleIds: JSON.parse((r.article_ids as string) || '[]'),
    source: r.source,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export default router;
