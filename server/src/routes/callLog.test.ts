import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

import express from 'express';
import supertest from 'supertest';
import { errorMiddleware } from '../middleware/errorHandler.js';
import callLogRouter from './callLog.js';

const app = express();
app.use(express.json());
app.use('/api/worlds/:wid/call-log', callLogRouter);
app.use(errorMiddleware);
const req = supertest(app);

const WID = 'test-world';

function reseed() {
  dbRef.db!.exec(`DELETE FROM call_log; DELETE FROM worlds;`);
  const now = Date.now();
  dbRef.db!.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES (?, 'TestWorld', 'desc', '[]', 'narrative', ?, ?)`).run(WID, now, now);
}

function insertCall(params: {
  agentType: string; tokensIn: number; tokensOut: number; iterations: number | null;
  pipelineRunId: string | null; pipelineType: string | null; createdAt: number;
}) {
  dbRef.db!.prepare(`
    INSERT INTO call_log
      (id, world_id, owner_id, agent_type, tokens_in, tokens_out, status, iterations, pipeline_run_id, pipeline_type, created_at)
    VALUES (lower(hex(randomblob(8))), ?, 'local-user', ?, ?, ?, 'success', ?, ?, ?, ?)
  `).run(WID, params.agentType, params.tokensIn, params.tokensOut, params.iterations, params.pipelineRunId, params.pipelineType, params.createdAt);
}

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
});

beforeEach(() => {
  reseed();
});

describe('GET /api/worlds/:wid/call-log/summary', () => {
  it('rolls up calls by agent type with averages', async () => {
    insertCall({ agentType: 'scribe', tokensIn: 100, tokensOut: 50, iterations: 1, pipelineRunId: null, pipelineType: null, createdAt: Date.now() });
    insertCall({ agentType: 'scribe', tokensIn: 200, tokensOut: 100, iterations: 3, pipelineRunId: null, pipelineType: null, createdAt: Date.now() });
    insertCall({ agentType: 'lorekeeper', tokensIn: 50, tokensOut: 20, iterations: 1, pipelineRunId: null, pipelineType: null, createdAt: Date.now() });

    const res = await req.get(`/api/worlds/${WID}/call-log/summary`);
    expect(res.status).toBe(200);

    const scribe = res.body.agents.find((a: { agentType: string }) => a.agentType === 'scribe');
    expect(scribe).toMatchObject({ calls: 2, avgTokensIn: 150, avgTokensOut: 75, avgIterations: 2 });

    const lorekeeper = res.body.agents.find((a: { agentType: string }) => a.agentType === 'lorekeeper');
    expect(lorekeeper).toMatchObject({ calls: 1, avgTokensIn: 50, avgTokensOut: 20, avgIterations: 1 });
  });

  it('returns 404 for an unknown world', async () => {
    const res = await req.get(`/api/worlds/does-not-exist/call-log/summary`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/worlds/:wid/call-log/runs', () => {
  it('groups calls by pipeline_run_id and lists the agent chain in call order', async () => {
    const t0 = Date.now();
    insertCall({ agentType: 'researcher', tokensIn: 100, tokensOut: 20, iterations: 1, pipelineRunId: 'run-1', pipelineType: 'expand', createdAt: t0 });
    insertCall({ agentType: 'scribe', tokensIn: 300, tokensOut: 150, iterations: 2, pipelineRunId: 'run-1', pipelineType: 'expand', createdAt: t0 + 1000 });
    insertCall({ agentType: 'muse', tokensIn: 80, tokensOut: 40, iterations: 1, pipelineRunId: 'run-2', pipelineType: 'propose', createdAt: t0 + 2000 });
    // Not part of any pipeline run — must not appear in the grouping.
    insertCall({ agentType: 'stylist', tokensIn: 10, tokensOut: 5, iterations: 1, pipelineRunId: null, pipelineType: null, createdAt: t0 + 3000 });

    const res = await req.get(`/api/worlds/${WID}/call-log/runs`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);

    const run1 = res.body.runs.find((r: { pipelineRunId: string }) => r.pipelineRunId === 'run-1');
    expect(run1).toMatchObject({
      pipelineType: 'expand',
      calls: 2,
      totalTokensIn: 400,
      totalTokensOut: 170,
      agents: ['researcher', 'scribe'],
    });

    const run2 = res.body.runs.find((r: { pipelineRunId: string }) => r.pipelineRunId === 'run-2');
    expect(run2).toMatchObject({ pipelineType: 'propose', calls: 1, agents: ['muse'] });
  });
});
