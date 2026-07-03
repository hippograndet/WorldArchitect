import { Router } from 'express';
import { getDbClient } from '../db/client.js';
import { getDailyCallCount } from '../services/callLogger.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router({ mergeParams: true });

// GET /api/worlds/:wid/call-log?page=1&limit=50
router.get('/', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const db = getDbClient();

  const worldExists = await db.get('SELECT id FROM worlds WHERE id = ?', [wid]);
  if (!worldExists) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)));
  const offset = (page - 1) * limit;

  const rows = await db.all(`
      SELECT * FROM call_log
      WHERE world_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [wid, limit, offset]) as Record<string, unknown>[];

  const totalRow = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM call_log WHERE world_id = ?', [wid]);
  const total = totalRow?.count ?? 0;

  const dailyCount = await getDailyCallCount(wid);

  res.json({
    calls: rows.map((r) => ({
      id:           r.id,
      agentType:    r.agent_type,
      articleId:    r.article_id ?? null,
      tokensIn:     r.tokens_in ?? null,
      tokensOut:    r.tokens_out ?? null,
      status:       r.status,
      errorMessage: r.error_message ?? null,
      createdAt:    r.created_at,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    todayCount: dailyCount,
  });
}));

export default router;
