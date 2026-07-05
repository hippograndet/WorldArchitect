import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

const forgeGraph = vi.hoisted(() => ({
  startForgeRun: vi.fn().mockResolvedValue(undefined),
  resumeForgeRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../agents/graphs/forgeGraph.js', () => forgeGraph);

import express from 'express';
import supertest from 'supertest';
import { errorMiddleware } from '../middleware/errorHandler.js';
import runsRouter from './runs.js';

const CREATE_BODY = { articleIds: ['art1'], pipelineType: 'expand_description' as const };

const app = express();
app.use(express.json());
app.use('/api/worlds/:wid/runs', runsRouter);
app.use(errorMiddleware);
const req = supertest(app);

const WID = 'test-world';
const CAT_ID = 'test-cat';

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
});

function reseed() {
  dbRef.db!.exec(`
    DELETE FROM runs;
    DELETE FROM articles;
    DELETE FROM categories;
    DELETE FROM worlds;
  `);
  const now = Date.now();
  dbRef.db!.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES (?, 'TestWorld', 'desc', '[]', 'narrative', ?, ?)`).run(WID, now, now);
  dbRef.db!.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES (?, ?, 'Lore', 0, ?)`).run(CAT_ID, WID, now);
  dbRef.db!.prepare(`INSERT INTO articles (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
    VALUES ('art1', ?, ?, 'Article One', 'draft', 'general', NULL, ?, ?)`).run(WID, CAT_ID, now, now);
  dbRef.db!.prepare(`INSERT INTO articles (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
    VALUES ('art2', ?, ?, 'Article Two', 'draft', 'general', NULL, ?, ?)`).run(WID, CAT_ID, now, now);
}

beforeEach(() => {
  reseed();
});

describe('POST /api/worlds/:wid/runs', () => {
  it('creates a run and locks target articles', async () => {
    const res = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1', 'art2'] });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');
    expect(res.body.articleIds).toEqual(['art1', 'art2']);

    const article = dbRef.db!.prepare(`SELECT locked_by_run_id FROM articles WHERE id = 'art1'`).get() as { locked_by_run_id: string };
    expect(article.locked_by_run_id).toBe(res.body.id);
  });

  it('returns 404 when an article does not belong to the world', async () => {
    const res = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['does-not-exist'] });
    expect(res.status).toBe(404);
  });

  it('returns 409 when an article is already locked by another run', async () => {
    await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1'] }).expect(202);

    const res = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1', 'art2'] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ARTICLE_LOCKED');

    // art2 must not have been locked by the failed attempt
    const art2 = dbRef.db!.prepare(`SELECT locked_by_run_id FROM articles WHERE id = 'art2'`).get() as { locked_by_run_id: string | null };
    expect(art2.locked_by_run_id).toBeNull();
  });

  it('returns 400 when articleIds is empty', async () => {
    const res = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pipelineType is missing', async () => {
    const res = await req.post(`/api/worlds/${WID}/runs`).send({ articleIds: ['art1'] });
    expect(res.status).toBe(400);
  });

  it('kicks off the Forge graph for the root article', async () => {
    const res = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1'] });
    expect(res.status).toBe(202);
    expect(forgeGraph.startForgeRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: res.body.id,
      worldId: WID,
      articleId: 'art1',
      articleTitle: 'Article One',
      startStep: 'expansion',
    }));
  });
});

describe('GET /api/worlds/:wid/runs', () => {
  it('lists runs newest first', async () => {
    const first = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1'] });
    const list = await req.get(`/api/worlds/${WID}/runs`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(first.body.id);
  });
});

describe('GET /api/worlds/:wid/runs/:rid', () => {
  it('returns 404 for an unknown run', async () => {
    const res = await req.get(`/api/worlds/${WID}/runs/ghost`);
    expect(res.status).toBe(404);
  });

  it('includes the run_events log', async () => {
    const created = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1'] });
    const res = await req.get(`/api/worlds/${WID}/runs/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });
});

describe('POST /api/worlds/:wid/runs/:rid/cancel', () => {
  it('marks the run stopped and releases locks', async () => {
    const created = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1'] });
    const res = await req.post(`/api/worlds/${WID}/runs/${created.body.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stopped');

    const article = dbRef.db!.prepare(`SELECT locked_by_run_id FROM articles WHERE id = 'art1'`).get() as { locked_by_run_id: string | null };
    expect(article.locked_by_run_id).toBeNull();
  });
});

describe('POST /api/worlds/:wid/runs/:rid/pause', () => {
  it('marks a running run paused', async () => {
    const created = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1'] });
    dbRef.db!.prepare(`UPDATE runs SET status = 'running' WHERE id = ?`).run(created.body.id);

    const res = await req.post(`/api/worlds/${WID}/runs/${created.body.id}/pause`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');
  });

  it('rejects pausing a run that already finished', async () => {
    const created = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1'] });
    dbRef.db!.prepare(`UPDATE runs SET status = 'completed' WHERE id = ?`).run(created.body.id);

    const res = await req.post(`/api/worlds/${WID}/runs/${created.body.id}/pause`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RUN_NOT_RUNNING');
  });
});

describe('POST /api/worlds/:wid/runs/:rid/resume', () => {
  it('rejects resuming a run that is not paused', async () => {
    const created = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1'] });
    const res = await req.post(`/api/worlds/${WID}/runs/${created.body.id}/resume`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RUN_NOT_PAUSED');
  });

  it('accepts resuming a paused run', async () => {
    const created = await req.post(`/api/worlds/${WID}/runs`).send({ ...CREATE_BODY, articleIds: ['art1'] });
    dbRef.db!.prepare(`UPDATE runs SET status = 'paused' WHERE id = ?`).run(created.body.id);

    const res = await req.post(`/api/worlds/${WID}/runs/${created.body.id}/resume`);
    expect(res.status).toBe(202);
    expect(forgeGraph.resumeForgeRun).toHaveBeenCalledWith({ worldId: WID, runId: created.body.id });
  });
});
