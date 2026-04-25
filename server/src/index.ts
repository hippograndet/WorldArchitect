import express from 'express';
import { getDb, DB_PATH } from './db/index.js';
import worldRoutes from './routes/worlds.js';
import categoryRoutes from './routes/categories.js';
import articleRoutes from './routes/articles.js';
import bibleRoutes from './routes/bible.js';
import settingsRoutes, { worldSettingsRouter } from './routes/settings.js';
import callLogRoutes from './routes/callLog.js';

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
app.use('/api/worlds/:wid/categories', categoryRoutes);
app.use('/api/worlds/:wid/articles', articleRoutes);
app.use('/api/worlds/:wid/bible', bibleRoutes);
app.use('/api/worlds/:wid/settings', worldSettingsRouter);
app.use('/api/worlds/:wid/call-log', callLogRoutes);
app.use('/api/settings', settingsRoutes);

getDb();

app.listen(PORT, () => {
  console.log(`WorldArchitect server running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
