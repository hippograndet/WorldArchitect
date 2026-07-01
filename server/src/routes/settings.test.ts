import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

import express from 'express';
import supertest from 'supertest';
import settingsRouter from './settings.js';
import { logCall } from '../services/callLogger.js';

const app = express();
app.use(express.json());
app.use('/api/settings', settingsRouter);
const req = supertest(app);

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
});

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
  dbRef.db!.exec(`
    DELETE FROM call_log;
    DELETE FROM cost_settings;
    DELETE FROM worlds;
    UPDATE provider_settings SET provider = 'none', config = '{}', updated_at = 0 WHERE id = 'singleton';
  `);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('provider settings secret handling', () => {
  it('stores app-submitted keys locally but returns only masked values', async () => {
    const rawKey = 'sk-ant-test-key-abcdefghijklmnopqrstuvwxyz';

    const patch = await req.patch('/api/settings').send({
      provider: 'anthropic',
      apiKey: rawKey,
      model: 'claude-test',
    });
    expect(patch.status).toBe(200);

    const get = await req.get('/api/settings');
    expect(get.status).toBe(200);
    expect(get.body.provider).toBe('anthropic');
    expect(get.body.anthropic).toMatchObject({
      keySet: true,
      keySource: 'app',
      model: 'claude-test',
    });
    expect(JSON.stringify(get.body)).not.toContain(rawKey);
    expect(get.body.anthropic.keyMasked).toMatch(/^sk-ant\*\*\*\*/);

    const row = dbRef.db!
      .prepare("SELECT config FROM provider_settings WHERE id = 'singleton'")
      .get() as { config: string };
    expect(row.config).toContain(rawKey);
  });

  it('uses env keys at runtime without writing them back to stored settings', async () => {
    const storedKey = 'sk-app-key-abcdefghijklmnopqrstuvwxyz';
    const envKey = 'sk-env-key-abcdefghijklmnopqrstuvwxyz';

    await req.patch('/api/settings').send({ provider: 'openai', apiKey: storedKey });
    process.env.OPENAI_API_KEY = envKey;
    process.env.OPENAI_MODEL = 'gpt-env';

    const get = await req.get('/api/settings');
    expect(get.status).toBe(200);
    expect(get.body.openai.keySource).toBe('env');
    expect(get.body.openai.model).toBe('gpt-env');
    expect(JSON.stringify(get.body)).not.toContain(storedKey);
    expect(JSON.stringify(get.body)).not.toContain(envKey);

    const row = dbRef.db!
      .prepare("SELECT config FROM provider_settings WHERE id = 'singleton'")
      .get() as { config: string };
    expect(row.config).toContain(storedKey);
    expect(row.config).not.toContain(envKey);
  });
});

describe('local-only egress settings', () => {
  it('lets the app enable local-only mode through settings', async () => {
    const patch = await req.patch('/api/settings').send({
      provider: 'ollama',
      localOnly: true,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.localOnly).toEqual({ enabled: true, forcedByEnv: false });

    const get = await req.get('/api/settings');
    expect(get.body.localOnly).toEqual({ enabled: true, forcedByEnv: false });
  });

  it('does not let app settings disable an env-forced local-only lock', async () => {
    process.env.WORLDARCHITECT_LOCAL_ONLY = '1';

    const patch = await req.patch('/api/settings').send({
      provider: 'openai',
      localOnly: false,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.localOnly).toEqual({ enabled: true, forcedByEnv: true });

    const get = await req.get('/api/settings');
    expect(get.body.localOnly).toEqual({ enabled: true, forcedByEnv: true });
  });
});

describe('call log redaction', () => {
  it('redacts API-key-looking values before persisting error messages', () => {
    const now = Date.now();
    dbRef.db!.prepare(`
      INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
      VALUES ('w1', 'World', 'A world description long enough.', '[]', 'narrative', ?, ?)
    `).run(now, now);

    logCall({
      worldId: 'w1',
      agentType: 'scribe',
      status: 'error',
      errorMessage: 'Provider rejected key sk-ant-test-key-abcdefghijklmnopqrstuvwxyz',
    });

    const row = dbRef.db!.prepare('SELECT error_message FROM call_log').get() as { error_message: string };
    expect(row.error_message).toContain('[REDACTED_SECRET]');
    expect(row.error_message).not.toContain('sk-ant-test-key');
  });
});
