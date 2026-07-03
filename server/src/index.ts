import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { nanoid as _nanoid } from 'nanoid';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { DB_PATH } from './db/index.js';
import { getDbClient } from './db/client.js';
import { getStorageAdapter } from './db/storage.js';
import { authMiddleware } from './auth.js';
import { getAppMode, getPublicBaseUrl } from './config.js';
import { requireWorldTenant, tenantIdFor } from './tenant.js';
import { requestContextMiddleware } from './requestContext.js';
import { asyncHandler } from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { requestIdMiddleware } from './middleware/requestId.js';
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
import { assertNoCommittedSecrets } from './security/secretScan.js';
import { logger } from './observability/logger.js';

const app = express();
const PORT = 3001;

assertNoCommittedSecrets();

// First in the chain so even pre-auth/malformed requests get a correlatable id.
app.use(requestIdMiddleware);

// Required for correct req.ip (and thus correct rate-limit keying) behind a
// reverse proxy (Render/Fly/Railway all sit in front of the app).
app.set('trust proxy', process.env.TRUST_PROXY ?? 1);

// CSP is disabled only for the optional same-process STATIC_DIR SPA-fallback
// path (a bundled index.html), since the normal hosted deploy serves the
// client from a separate origin and default CSP has nothing to conflict with.
app.use(helmet({ contentSecurityPolicy: process.env.STATIC_DIR ? false : undefined }));

app.use(express.json({ limit: '2mb' }));

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', getPublicBaseUrl());
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-worldarchitect-user-id');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use('/api', apiRateLimiter);

app.use('/api', (req, res, next) => {
  void authMiddleware(req, res, next);
});
app.use('/api', requestContextMiddleware);

app.get('/health', async (_req, res) => {
  const storage = getStorageAdapter();
  const health = await storage.health();
  res.json({
    status: health.ok ? 'ok' : 'degraded',
    mode: getAppMode(),
    storage: health,
    db: DB_PATH,
  });
});

app.use('/api/worlds', worldRoutes);
app.use('/api/worlds/:wid/articles', requireWorldTenant, articleRoutes);
app.use('/api/worlds/:wid/bible', requireWorldTenant, bibleRoutes);
app.use('/api/worlds/:wid/settings', requireWorldTenant, worldSettingsRouter);
app.use('/api/worlds/:wid/call-log', requireWorldTenant, callLogRoutes);
app.use('/api/worlds/:wid/agents', requireWorldTenant, agentRoutes);
app.use('/api/worlds/:wid/snapshots', requireWorldTenant, snapshotRoutes);
app.use('/api/worlds/:wid/export', requireWorldTenant, exportRoutes);
app.use('/api/worlds/:wid/names', requireWorldTenant, nameBankRoutes);
app.use('/api/worlds/:wid/entity-mentions', requireWorldTenant, entityMentionsRoutes);
app.use('/api/worlds/:wid/publish', requireWorldTenant, publishRoutes);
app.use('/api/settings', settingsRoutes);

// World-wide article issues summary
app.get('/api/worlds/:wid/issues', requireWorldTenant, asyncHandler(async (req, res) => {
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

// World-level issues (Auditor globalWarnings, persisted tickets)
app.get('/api/worlds/:wid/world-issues', requireWorldTenant, asyncHandler(async (req, res) => {
  const worldId = req.params.wid;
  const { status, severity, type } = req.query as Record<string, string | undefined>;

  let sql = `SELECT * FROM world_issues WHERE world_id = ? AND owner_id = ?`;
  const params: unknown[] = [worldId, tenantIdFor(req)];

  if (status) { sql += ` AND status = ?`; params.push(status); }
  if (severity) { sql += ` AND severity = ?`; params.push(severity); }
  if (type) { sql += ` AND type = ?`; params.push(type); }
  sql += ` ORDER BY created_at DESC`;

  const rows = await getDbClient().all<Record<string, unknown>>(sql, params);
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
}));

app.patch('/api/worlds/:wid/world-issues/:iid', requireWorldTenant, asyncHandler(async (req, res) => {
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

// World issues that reference a specific article
app.get('/api/worlds/:wid/articles/:aid/world-issues', requireWorldTenant, asyncHandler(async (req, res) => {
  const { wid, aid } = req.params;

  const rows = await getDbClient().all<Record<string, unknown>>(
    `SELECT * FROM world_issues WHERE world_id = ? AND owner_id = ? AND status != 'dismissed' AND article_ids LIKE ? ORDER BY created_at DESC`,
    [wid, tenantIdFor(req), `%"${aid}"%`],
  );

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
}));

const staticDir = process.env.STATIC_DIR;
if (staticDir && existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
      next();
      return;
    }
    res.sendFile(resolve(staticDir, 'index.html'));
  });
}

await getStorageAdapter().migrate();

app.use(errorMiddleware);

app.listen(PORT, () => {
  logger.info('server.started', {
    url: `http://localhost:${PORT}`,
    db: DB_PATH,
    sentryConfigured: !!process.env.SENTRY_DSN,
  });
});
