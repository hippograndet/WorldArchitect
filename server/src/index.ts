import express from 'express';
import { z } from 'zod';
import { nanoid as _nanoid } from 'nanoid';
import { getDb, DB_PATH } from './db/index.js';
import worldRoutes from './routes/worlds.js';
import articleRoutes from './routes/articles.js';
import bibleRoutes from './routes/bible.js';
import settingsRoutes, { worldSettingsRouter } from './routes/settings.js';
import callLogRoutes from './routes/callLog.js';
import agentRoutes from './routes/agents.js';
import snapshotRoutes from './routes/snapshots.js';
import exportRoutes from './routes/export.js';
import nameBankRoutes from './routes/nameBank.js';
import entityMentionsRoutes from './routes/entityMentions.js';
import { errorMiddleware } from './middleware/errorHandler.js';
import publishRoutes from './routes/publish.js';

const app = express();
const PORT = 3001;

app.use(express.json({ limit: '2mb' }));

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  const db = getDb();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all() as { name: string }[];

  res.json({
    status: 'ok',
    db: DB_PATH,
    tables: tables.map((t) => t.name),
  });
});

app.use('/api/worlds', worldRoutes);
app.use('/api/worlds/:wid/articles', articleRoutes);
app.use('/api/worlds/:wid/bible', bibleRoutes);
app.use('/api/worlds/:wid/settings', worldSettingsRouter);
app.use('/api/worlds/:wid/call-log', callLogRoutes);
app.use('/api/worlds/:wid/agents', agentRoutes);
app.use('/api/worlds/:wid/snapshots', snapshotRoutes);
app.use('/api/worlds/:wid/export', exportRoutes);
app.use('/api/worlds/:wid/names', nameBankRoutes);
app.use('/api/worlds/:wid/entity-mentions', entityMentionsRoutes);
app.use('/api/worlds/:wid/publish', publishRoutes);
app.use('/api/settings', settingsRoutes);

// World-wide article issues summary
app.get('/api/worlds/:wid/issues', (req, res) => {
  const db = getDb();
  const wid = req.params.wid;

  const summary = db.prepare(`
    SELECT severity, COUNT(*) AS count
    FROM article_issues
    WHERE world_id = ? AND status = 'open'
    GROUP BY severity
  `).all(wid) as { severity: string; count: number }[];

  const blocking = summary.find(s => s.severity === 'blocking')?.count ?? 0;
  const warnings = summary.find(s => s.severity === 'warning')?.count ?? 0;

  res.json({ blocking, warnings, total: blocking + warnings });
});

// World-level issues (Auditor globalWarnings, persisted tickets)
app.get('/api/worlds/:wid/world-issues', (req, res) => {
  const db = getDb();
  const worldId = req.params.wid;
  const { status, severity, type } = req.query as Record<string, string | undefined>;

  let sql = `SELECT * FROM world_issues WHERE world_id = ?`;
  const params: unknown[] = [worldId];

  if (status) { sql += ` AND status = ?`; params.push(status); }
  if (severity) { sql += ` AND severity = ?`; params.push(severity); }
  if (type) { sql += ` AND type = ?`; params.push(type); }
  sql += ` ORDER BY created_at DESC`;

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json(rows.map(r => ({
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
  })));
});

app.patch('/api/worlds/:wid/world-issues/:iid', (req, res) => {
  const parse = z.object({
    status: z.enum(['open', 'in_review', 'resolved', 'dismissed']),
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid status', code: 'VALIDATION_ERROR' });
    return;
  }

  const db = getDb();
  const { wid, iid } = req.params;
  const now = Date.now();
  const result = db.prepare(
    `UPDATE world_issues SET status = ?, updated_at = ? WHERE id = ? AND world_id = ?`,
  ).run(parse.data.status, now, iid, wid);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Issue not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ ok: true });
});

// World issues that reference a specific article
app.get('/api/worlds/:wid/articles/:aid/world-issues', (req, res) => {
  const db = getDb();
  const { wid, aid } = req.params;

  const rows = db.prepare(
    `SELECT * FROM world_issues WHERE world_id = ? AND status != 'dismissed' AND article_ids LIKE ? ORDER BY created_at DESC`,
  ).all(wid, `%"${aid}"%`) as Array<Record<string, unknown>>;

  res.json(rows.map(r => ({
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
  })));
});

getDb();

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`WorldArchitect server running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
