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
      id:            r.id,
      agentType:     r.agent_type,
      articleId:     r.article_id ?? null,
      tokensIn:      r.tokens_in ?? null,
      tokensOut:     r.tokens_out ?? null,
      status:        r.status,
      errorMessage:  r.error_message ?? null,
      iterations:    r.iterations ?? null,
      pipelineRunId: r.pipeline_run_id ?? null,
      pipelineType:  r.pipeline_type ?? null,
      createdAt:     r.created_at,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    todayCount: dailyCount,
  });
}));

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/call-log/summary — per-agent-type rollup
// ---------------------------------------------------------------------------

router.get('/summary', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const db = getDbClient();

  const worldExists = await db.get('SELECT id FROM worlds WHERE id = ?', [wid]);
  if (!worldExists) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const rows = await db.all<{
    agent_type: string;
    calls: number;
    avg_tokens_in: number | null;
    avg_tokens_out: number | null;
    avg_iterations: number | null;
  }>(`
      SELECT agent_type,
             COUNT(*) AS calls,
             AVG(tokens_in) AS avg_tokens_in,
             AVG(tokens_out) AS avg_tokens_out,
             AVG(iterations) AS avg_iterations
      FROM call_log
      WHERE world_id = ?
      GROUP BY agent_type
      ORDER BY calls DESC
    `, [wid]);

  res.json({
    agents: rows.map((r) => ({
      agentType:     r.agent_type,
      calls:         r.calls,
      avgTokensIn:   r.avg_tokens_in !== null ? Math.round(r.avg_tokens_in) : null,
      avgTokensOut:  r.avg_tokens_out !== null ? Math.round(r.avg_tokens_out) : null,
      avgIterations: r.avg_iterations !== null ? Math.round(r.avg_iterations * 10) / 10 : null,
    })),
  });
}));

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/call-log/runs?page=1&limit=20 — per-pipeline-run grouping
// ---------------------------------------------------------------------------

router.get('/runs', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const db = getDbClient();

  const worldExists = await db.get('SELECT id FROM worlds WHERE id = ?', [wid]);
  if (!worldExists) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
  const offset = (page - 1) * limit;

  const runRows = await db.all<{
    pipeline_run_id: string;
    pipeline_type: string | null;
    calls: number;
    total_tokens_in: number | null;
    total_tokens_out: number | null;
    started_at: number;
    ended_at: number;
  }>(`
      SELECT pipeline_run_id, pipeline_type,
             COUNT(*) AS calls,
             SUM(tokens_in) AS total_tokens_in,
             SUM(tokens_out) AS total_tokens_out,
             MIN(created_at) AS started_at,
             MAX(created_at) AS ended_at
      FROM call_log
      WHERE world_id = ? AND pipeline_run_id IS NOT NULL
      GROUP BY pipeline_run_id, pipeline_type
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `, [wid, limit, offset]);

  const totalRow = await db.get<{ count: number }>(`
      SELECT COUNT(DISTINCT pipeline_run_id) AS count FROM call_log
      WHERE world_id = ? AND pipeline_run_id IS NOT NULL
    `, [wid]);
  const total = totalRow?.count ?? 0;

  // Per-run agent chain, assembled in application code rather than a SQL
  // string-aggregation function (GROUP_CONCAT vs. string_agg dialect drift —
  // see executor.ts's driver-agnostic QueryExecutor design).
  const runIds = runRows.map((r) => r.pipeline_run_id);
  const agentRows = runIds.length > 0
    ? await db.all<{ pipeline_run_id: string; agent_type: string }>(`
        SELECT pipeline_run_id, agent_type FROM call_log
        WHERE world_id = ? AND pipeline_run_id IN (${runIds.map(() => '?').join(',')})
        ORDER BY created_at ASC
      `, [wid, ...runIds])
    : [];

  const agentsByRun = new Map<string, string[]>();
  for (const row of agentRows) {
    if (!agentsByRun.has(row.pipeline_run_id)) agentsByRun.set(row.pipeline_run_id, []);
    agentsByRun.get(row.pipeline_run_id)!.push(row.agent_type);
  }

  res.json({
    runs: runRows.map((r) => ({
      pipelineRunId:  r.pipeline_run_id,
      pipelineType:   r.pipeline_type,
      calls:          r.calls,
      totalTokensIn:  r.total_tokens_in ?? 0,
      totalTokensOut: r.total_tokens_out ?? 0,
      startedAt:      r.started_at,
      endedAt:        r.ended_at,
      agents:         agentsByRun.get(r.pipeline_run_id) ?? [],
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}));

export default router;
