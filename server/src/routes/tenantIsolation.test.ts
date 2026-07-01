import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

vi.mock('../providers/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers/index.js')>();
  return {
    ...actual,
    isLLMConfigured: () => false,
    requireLLM: (_req: unknown, _res: unknown, next: () => void) => next(),
    getProvider: () => { throw new Error('No LLM configured'); },
  };
});

import express from 'express';
import supertest from 'supertest';
import worldsRouter from './worlds.js';
import articlesRouter from './articles.js';
import settingsRouter, { worldSettingsRouter } from './settings.js';
import { authMiddleware } from '../auth.js';
import { requestContextMiddleware } from '../requestContext.js';
import { requireWorldTenant } from '../tenant.js';

const ORIGINAL_ENV = { ...process.env };

const app = express();
app.use(express.json());
app.use('/api', (req, res, next) => {
  void authMiddleware(req, res, next);
});
app.use('/api', requestContextMiddleware);
app.use('/api/worlds', worldsRouter);
app.use('/api/worlds/:wid/articles', requireWorldTenant, articlesRouter);
app.use('/api/worlds/:wid/settings', requireWorldTenant, worldSettingsRouter);
app.use('/api/settings', settingsRouter);

const req = supertest(app);

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
});

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    APP_MODE: 'hosted',
    ALLOW_DEV_AUTH_HEADER: '1',
    PROVIDER_SETTINGS_ENCRYPTION_KEY: 'test-encryption-key',
  };
  dbRef.db!.exec(`
    DELETE FROM world_bible_entries;
    DELETE FROM world_bible_meta;
    DELETE FROM cost_settings;
    DELETE FROM categories;
    DELETE FROM worlds;
    DELETE FROM provider_settings WHERE id != 'singleton';
    UPDATE provider_settings SET provider = 'none', config = '{}', updated_at = 0 WHERE id = 'singleton';
  `);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function asUser(userId: string) {
  return { 'x-worldarchitect-user-id': userId };
}

async function createWorld(userId: string, name: string) {
  const res = await req
    .post('/api/worlds')
    .set(asUser(userId))
    .send({
      name,
      description: `A long enough description for ${name}.`,
    });
  expect(res.status).toBe(201);
  return res.body.world as { id: string; name: string };
}

describe('hosted tenant isolation', () => {
  it('prevents user A from reading or mutating user B worlds', async () => {
    const worldA = await createWorld('user-a', 'World A');
    const worldB = await createWorld('user-b', 'World B');

    const listA = await req.get('/api/worlds').set(asUser('user-a'));
    expect(listA.status).toBe(200);
    expect(listA.body.map((world: { id: string }) => world.id)).toEqual([worldA.id]);

    const readB = await req.get(`/api/worlds/${worldB.id}`).set(asUser('user-a'));
    expect(readB.status).toBe(404);

    const patchB = await req
      .patch(`/api/worlds/${worldB.id}`)
      .set(asUser('user-a'))
      .send({ name: 'Stolen World' });
    expect(patchB.status).toBe(404);

    const settingsB = await req.get(`/api/worlds/${worldB.id}/settings`).set(asUser('user-a'));
    expect(settingsB.status).toBe(404);

    const articlesB = await req.get(`/api/worlds/${worldB.id}/articles`).set(asUser('user-a'));
    expect(articlesB.status).toBe(404);

    const readBOwner = await req.get(`/api/worlds/${worldB.id}`).set(asUser('user-b'));
    expect(readBOwner.status).toBe(200);
    expect(readBOwner.body.name).toBe('World B');
  });

  it('stores hosted provider settings per user and encrypted at rest', async () => {
    const rawKey = 'sk-ant-test-key-abcdefghijklmnopqrstuvwxyz';

    const save = await req
      .patch('/api/settings')
      .set(asUser('user-a'))
      .send({ provider: 'anthropic', apiKey: rawKey });
    expect(save.status).toBe(200);

    const userA = await req.get('/api/settings').set(asUser('user-a'));
    const userB = await req.get('/api/settings').set(asUser('user-b'));
    expect(userA.body.provider).toBe('anthropic');
    expect(userA.body.anthropic.keySet).toBe(true);
    expect(userB.body.provider).toBe('none');
    expect(userB.body.anthropic.keySet).toBe(false);

    const stored = dbRef.db!
      .prepare("SELECT config FROM provider_settings WHERE id = 'user-a'")
      .get() as { config: string };
    expect(stored.config).not.toContain(rawKey);
    expect(stored.config).toContain('enc:v1:');
    expect(JSON.stringify(userA.body)).not.toContain(rawKey);
  });
});
