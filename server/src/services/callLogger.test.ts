import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

import { logCall, getDailyCallCount, checkDailyCap } from './callLogger.js';

function seed(db: Database.Database) {
  const now = Date.now();
  db.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES ('world1', 'TestWorld', 'desc', '[]', 'narrative', ?, ?)`).run(now, now);
}

function clearAll(db: Database.Database) {
  db.exec(`DELETE FROM call_log; DELETE FROM cost_settings; DELETE FROM worlds;`);
}

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
});

beforeEach(() => {
  clearAll(dbRef.db!);
  seed(dbRef.db!);
});

describe('logCall', () => {
  it('persists iterations, pipelineRunId, and pipelineType alongside the existing fields', async () => {
    await logCall({
      worldId: 'world1',
      agentType: 'scribe',
      tokensIn: 100,
      tokensOut: 50,
      status: 'success',
      iterations: 3,
      pipelineRunId: 'run-abc',
      pipelineType: 'expand',
    });

    const row = dbRef.db!.prepare(`SELECT * FROM call_log WHERE world_id = 'world1'`).get() as Record<string, unknown>;
    expect(row.iterations).toBe(3);
    expect(row.pipeline_run_id).toBe('run-abc');
    expect(row.pipeline_type).toBe('expand');
    expect(row.tokens_in).toBe(100);
    expect(row.tokens_out).toBe(50);
  });

  it('stores NULL for iterations/pipelineRunId/pipelineType when omitted (backward compatible)', async () => {
    await logCall({ worldId: 'world1', agentType: 'stylist', status: 'success' });

    const row = dbRef.db!.prepare(`SELECT * FROM call_log WHERE world_id = 'world1'`).get() as Record<string, unknown>;
    expect(row.iterations).toBeNull();
    expect(row.pipeline_run_id).toBeNull();
    expect(row.pipeline_type).toBeNull();
  });
});

describe('getDailyCallCount / checkDailyCap (unaffected by the new columns)', () => {
  it('counts only successful calls made today', async () => {
    await logCall({ worldId: 'world1', agentType: 'scribe', status: 'success' });
    await logCall({ worldId: 'world1', agentType: 'scribe', status: 'error' });

    await expect(getDailyCallCount('world1')).resolves.toBe(1);
  });

  it('allows calls when no daily cap is configured', async () => {
    const result = await checkDailyCap('world1');
    expect(result).toEqual({ allowed: true, current: 0, cap: null });
  });
});
