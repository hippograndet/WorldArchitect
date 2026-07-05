import type express from 'express';
import { DB_PATH } from '../db/index.js';
import { getStorageAdapter } from '../db/storage.js';
import { getAppMode } from '../config.js';
import { requireWorldTenant } from '../tenant.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import worldRoutes from './worlds.js';
import articleRoutes from './articles.js';
import bibleRoutes from './bible.js';
import settingsRoutes, { worldSettingsRouter } from './settings.js';
import callLogRoutes from './callLog.js';
import agentRoutes from './agents.js';
import snapshotRoutes from './snapshots.js';
import exportRoutes from './export.js';
import nameBankRoutes from './nameBank.js';
import entityMentionsRoutes from './entityMentions.js';
import publishRoutes from './publish.js';
import worldIssueRoutes from './worldIssues.js';
import runRoutes from './runs.js';

export function registerRoutes(app: express.Express): void {
  app.get('/health', asyncHandler(async (_req, res) => {
    const storage = getStorageAdapter();
    const health = await storage.health();
    res.json({
      status: health.ok ? 'ok' : 'degraded',
      mode: getAppMode(),
      storage: health,
      db: DB_PATH,
    });
  }));

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
  app.use('/api/worlds/:wid/runs', requireWorldTenant, runRoutes);
  app.use('/api/worlds/:wid', requireWorldTenant, worldIssueRoutes);
  app.use('/api/settings', settingsRoutes);
}
