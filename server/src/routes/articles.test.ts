import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

// ---------------------------------------------------------------------------
// In-memory DB via vi.hoisted so the mock factory captures it safely
// ---------------------------------------------------------------------------

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

import express from 'express';
import supertest from 'supertest';
import articlesRouter from './articles.js';

// Articles router uses mergeParams so it picks up :wid from the parent mount
const app = express();
app.use(express.json());
app.use('/api/worlds/:wid/articles', articlesRouter);
const req = supertest(app);

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
});

// Identifiers shared across tests
const WID = 'test-world';
const CAT_ID = 'test-cat';

function clearArticles() {
  dbRef.db!.exec(`
    DELETE FROM coherence_warnings;
    DELETE FROM pending_drafts;
    DELETE FROM world_bible_entries;
    DELETE FROM article_links;
    DELETE FROM article_versions;
    DELETE FROM articles;
  `);
}

beforeEach(clearArticles);

// Seed world + category once (FK checks are ON so articles need these)
beforeAll(() => {
  const now = Date.now();
  dbRef.db!.prepare(`
    INSERT OR IGNORE INTO worlds
      (id, name, description, tags, tone, created_at, updated_at)
    VALUES (?, 'TestWorld', 'A test world desc', '[]', 'narrative', ?, ?)
  `).run(WID, now, now);
  dbRef.db!.prepare(`
    INSERT OR IGNORE INTO categories
      (id, world_id, name, sort_order, created_at)
    VALUES (?, ?, 'Lore', 0, ?)
  `).run(CAT_ID, WID, now);
  dbRef.db!.prepare(`
    INSERT OR IGNORE INTO world_bible_meta (world_id, token_count, updated_at)
    VALUES (?, 0, ?)
  `).run(WID, now);
  dbRef.db!.prepare(`
    INSERT OR IGNORE INTO cost_settings (world_id, bible_threshold)
    VALUES (?, 80000)
  `).run(WID);
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createArticle(overrides: Record<string, unknown> = {}) {
  return req
    .post(`/api/worlds/${WID}/articles`)
    .send({ categoryId: CAT_ID, title: 'Test Article', ...overrides });
}

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/articles
// ---------------------------------------------------------------------------

describe('POST /api/worlds/:wid/articles', () => {
  it('creates an article with stub status when body is empty', async () => {
    const res = await createArticle({ body: '' });
    expect(res.status).toBe(201);
    expect(res.body.article.status).toBe('stub');
  });

  it('creates an article with draft status when body is non-empty', async () => {
    const res = await createArticle({ body: '## Description\n\nSome content here.' });
    expect(res.status).toBe(201);
    expect(res.body.article.status).toBe('draft');
  });

  it('returns article + version in the response', async () => {
    const res = await createArticle();
    expect(res.body.article).toBeDefined();
    expect(res.body.version).toBeDefined();
    expect(res.body.version.versionNumber).toBe(1);
  });

  it('stores the correct title', async () => {
    const res = await createArticle({ title: 'The Dragon King' });
    expect(res.body.article.title).toBe('The Dragon King');
  });

  it('returns 400 when title is missing', async () => {
    const res = await req
      .post(`/api/worlds/${WID}/articles`)
      .send({ categoryId: CAT_ID });
    expect(res.status).toBe(400);
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await req
      .post(`/api/worlds/${WID}/articles`)
      .send({ title: 'Some Title' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when world does not exist', async () => {
    const res = await req
      .post('/api/worlds/ghost/articles')
      .send({ categoryId: CAT_ID, title: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when category does not belong to the world', async () => {
    const res = await createArticle({ categoryId: 'wrong-cat' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Category not found');
  });

  it('defaults templateType to general', async () => {
    const res = await createArticle();
    expect(res.body.article.templateType).toBe('general');
  });

  it('accepts a valid templateType', async () => {
    const res = await createArticle({ templateType: 'character' });
    expect(res.body.article.templateType).toBe('character');
  });

  it('stores isFixedPoint correctly', async () => {
    const res = await createArticle({ isFixedPoint: true });
    expect(res.body.article.isFixedPoint).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/articles
// ---------------------------------------------------------------------------

describe('GET /api/worlds/:wid/articles', () => {
  it('returns empty array when no articles exist', async () => {
    const res = await req.get(`/api/worlds/${WID}/articles`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all articles for the world', async () => {
    await createArticle({ title: 'Alpha' });
    await createArticle({ title: 'Beta' });
    const res = await req.get(`/api/worlds/${WID}/articles`);
    expect(res.body).toHaveLength(2);
  });

  it('filters by status', async () => {
    await createArticle({ title: 'Stub Article', body: '' });
    await createArticle({ title: 'Draft Article', body: '## Description\n\nContent.' });
    const res = await req.get(`/api/worlds/${WID}/articles?status=stub`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Stub Article');
  });

  it('filters by title search query (case-insensitive LIKE)', async () => {
    await createArticle({ title: 'Dragon Lord' });
    await createArticle({ title: 'Ancient Elf' });
    const res = await req.get(`/api/worlds/${WID}/articles?q=dragon`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Dragon Lord');
  });

  it('filters by category', async () => {
    const now = Date.now();
    const cat2 = 'cat2-id';
    dbRef.db!.prepare(`
      INSERT OR IGNORE INTO categories (id, world_id, name, sort_order, created_at)
      VALUES (?, ?, 'Other', 1, ?)
    `).run(cat2, WID, now);

    await createArticle({ title: 'In Lore', categoryId: CAT_ID });
    await createArticle({ title: 'In Other', categoryId: cat2 });

    const res = await req.get(`/api/worlds/${WID}/articles?category=${cat2}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('In Other');
  });
});

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/articles/:aid
// ---------------------------------------------------------------------------

describe('GET /api/worlds/:wid/articles/:aid', () => {
  it('returns article + version + empty links + empty warnings', async () => {
    const { body: { article } } = await createArticle();
    const res = await req.get(`/api/worlds/${WID}/articles/${article.id}`);
    expect(res.status).toBe(200);
    expect(res.body.article.id).toBe(article.id);
    expect(res.body.version).toBeDefined();
    expect(res.body.links).toEqual([]);
    expect(res.body.openWarnings).toEqual([]);
  });

  it('returns 404 for a non-existent article', async () => {
    const res = await req.get(`/api/worlds/${WID}/articles/ghost`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when article belongs to a different world', async () => {
    const { body: { article } } = await createArticle();
    const res = await req.get(`/api/worlds/other-world/articles/${article.id}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/worlds/:wid/articles/:aid (manual edit)
// ---------------------------------------------------------------------------

describe('PATCH /api/worlds/:wid/articles/:aid', () => {
  it('creates a new version with the updated body', async () => {
    const { body: { article } } = await createArticle();
    const res = await req
      .patch(`/api/worlds/${WID}/articles/${article.id}`)
      .send({ body: '## Description\n\nUpdated content.' });
    expect(res.status).toBe(200);
    expect(res.body.version.versionNumber).toBe(2);
    expect(res.body.version.body).toBe('## Description\n\nUpdated content.');
  });

  it('sets status to draft when body is non-empty', async () => {
    const { body: { article } } = await createArticle({ body: '' });
    const res = await req
      .patch(`/api/worlds/${WID}/articles/${article.id}`)
      .send({ body: '## Description\n\nSome text.' });
    expect(res.body.article.status).toBe('draft');
  });

  it('sets status to stub when body is empty', async () => {
    const { body: { article } } = await createArticle({ body: '## Description\n\nText.' });
    const res = await req
      .patch(`/api/worlds/${WID}/articles/${article.id}`)
      .send({ body: '' });
    expect(res.body.article.status).toBe('stub');
  });

  it('updates the title when provided', async () => {
    const { body: { article } } = await createArticle();
    const res = await req
      .patch(`/api/worlds/${WID}/articles/${article.id}`)
      .send({ body: '', title: 'New Title' });
    expect(res.body.article.title).toBe('New Title');
  });

  it('increments version number on each edit', async () => {
    const { body: { article } } = await createArticle();
    const res1 = await req
      .patch(`/api/worlds/${WID}/articles/${article.id}`)
      .send({ body: 'v2 content' });
    const res2 = await req
      .patch(`/api/worlds/${WID}/articles/${article.id}`)
      .send({ body: 'v3 content' });
    expect(res1.body.version.versionNumber).toBe(2);
    expect(res2.body.version.versionNumber).toBe(3);
  });

  it('returns 400 when body field is missing', async () => {
    const { body: { article } } = await createArticle();
    const res = await req
      .patch(`/api/worlds/${WID}/articles/${article.id}`)
      .send({ status: 'reviewed' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent article', async () => {
    const res = await req
      .patch(`/api/worlds/${WID}/articles/ghost`)
      .send({ body: 'x' });
    expect(res.status).toBe(404);
  });

  it('derives summary from body first 50 words when summary not provided', async () => {
    const { body: { article } } = await createArticle();
    const longBody = 'word '.repeat(60).trim();
    const res = await req
      .patch(`/api/worlds/${WID}/articles/${article.id}`)
      .send({ body: longBody });
    // summary should be first 50 words
    const summaryWords = res.body.version.summary.trim().split(/\s+/);
    expect(summaryWords.length).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/worlds/:wid/articles/:aid
// ---------------------------------------------------------------------------

describe('DELETE /api/worlds/:wid/articles/:aid', () => {
  it('returns 204 on successful deletion', async () => {
    const { body: { article } } = await createArticle();
    const res = await req.delete(`/api/worlds/${WID}/articles/${article.id}`);
    expect(res.status).toBe(204);
  });

  it('makes the article unreachable after deletion', async () => {
    const { body: { article } } = await createArticle();
    await req.delete(`/api/worlds/${WID}/articles/${article.id}`);
    const res = await req.get(`/api/worlds/${WID}/articles/${article.id}`);
    expect(res.status).toBe(404);
  });

  it('cascades to article_versions on deletion', async () => {
    const { body: { article } } = await createArticle();
    await req.delete(`/api/worlds/${WID}/articles/${article.id}`);
    const versions = dbRef.db!
      .prepare('SELECT * FROM article_versions WHERE article_id = ?')
      .all(article.id);
    expect(versions).toHaveLength(0);
  });

  it('returns 404 for a non-existent article', async () => {
    const res = await req.delete(`/api/worlds/${WID}/articles/ghost`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Version history + revert
// ---------------------------------------------------------------------------

describe('GET /api/worlds/:wid/articles/:aid/versions', () => {
  it('returns all versions in DESC order', async () => {
    const { body: { article } } = await createArticle();
    await req.patch(`/api/worlds/${WID}/articles/${article.id}`).send({ body: 'v2' });
    await req.patch(`/api/worlds/${WID}/articles/${article.id}`).send({ body: 'v3' });
    const res = await req.get(`/api/worlds/${WID}/articles/${article.id}/versions`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].versionNumber).toBe(3);
    expect(res.body[2].versionNumber).toBe(1);
  });

  it('returns 404 for a non-existent article', async () => {
    const res = await req.get(`/api/worlds/${WID}/articles/ghost/versions`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/worlds/:wid/articles/:aid/revert/:vid', () => {
  it('creates a new version with the reverted body (returns version directly, status 201)', async () => {
    const { body: { article, version: v1 } } = await createArticle({
      body: '## Description\n\nOriginal.',
    });
    await req
      .patch(`/api/worlds/${WID}/articles/${article.id}`)
      .send({ body: '## Description\n\nChanged.' });

    // The revert endpoint returns the new ArticleVersion directly (not { article, version })
    const res = await req.post(
      `/api/worlds/${WID}/articles/${article.id}/revert/${v1.id}`,
    );
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('## Description\n\nOriginal.');
    expect(res.body.isRevert).toBe(true);
    expect(res.body.versionNumber).toBe(3);
  });

  it('marks the new version as a revert with the source versionId', async () => {
    const { body: { article, version: v1 } } = await createArticle({
      body: '## Description\n\nV1.',
    });
    await req.patch(`/api/worlds/${WID}/articles/${article.id}`).send({ body: 'V2' });
    const res = await req.post(
      `/api/worlds/${WID}/articles/${article.id}/revert/${v1.id}`,
    );
    expect(res.body.revertedFromVersionId).toBe(v1.id);
  });

  it('returns 404 for a non-existent article', async () => {
    const res = await req.post(`/api/worlds/${WID}/articles/ghost/revert/vid`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/articles/tree
// ---------------------------------------------------------------------------

describe('GET /api/worlds/:wid/articles/tree', () => {
  it('returns a flat list with parentId null for root articles', async () => {
    await createArticle({ title: 'Root' });
    const res = await req.get(`/api/worlds/${WID}/articles/tree`);
    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty('parentId', null);
    expect(res.body[0]).toHaveProperty('depth');
  });

  it('returns empty array when no articles exist', async () => {
    const res = await req.get(`/api/worlds/${WID}/articles/tree`);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Draft: save → get → discard
// ---------------------------------------------------------------------------

describe('Draft workflow (save / get / discard)', () => {
  const draftPayload = {
    phase: 'draft_ready' as const,
    pipelineType: 'expand_description' as const,
    draftContent: {
      description: 'A brand new description',
      coherenceWarnings: [],
      suggestedLinks: [],
      retentionIssues: [],
    },
  };

  it('saves a draft and retrieves it', async () => {
    const { body: { article } } = await createArticle();
    await req
      .post(`/api/worlds/${WID}/articles/${article.id}/draft`)
      .send(draftPayload)
      .expect(200);

    const res = await req.get(`/api/worlds/${WID}/articles/${article.id}/draft`);
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('draft_ready');
  });

  it('discards a draft successfully', async () => {
    const { body: { article } } = await createArticle();
    await req
      .post(`/api/worlds/${WID}/articles/${article.id}/draft`)
      .send(draftPayload);

    const del = await req.delete(`/api/worlds/${WID}/articles/${article.id}/draft`);
    expect(del.status).toBe(204);

    const res = await req.get(`/api/worlds/${WID}/articles/${article.id}/draft`);
    expect(res.status).toBe(404);
  });

  it('returns 400 when draft phase field is missing', async () => {
    const { body: { article } } = await createArticle();
    const res = await req
      .post(`/api/worlds/${WID}/articles/${article.id}/draft`)
      .send({ pipelineType: 'expand_description' }); // missing `phase`
    expect(res.status).toBe(400);
  });

  it('returns 404 when getting draft for non-existent article', async () => {
    const res = await req.get(`/api/worlds/${WID}/articles/ghost/draft`);
    expect(res.status).toBe(404);
  });

  it('rejects malformed generated draft content before mutating the article', async () => {
    const { body: { article } } = await createArticle({ body: '## Description\n\nOriginal.' });
    const before = await req.get(`/api/worlds/${WID}/articles/${article.id}`);

    dbRef.db!.prepare(`
      INSERT INTO pending_drafts
        (id, article_id, pipeline_type, selected_proposal, draft_content, expansion_params, phase, created_at, updated_at)
      VALUES ('bad-draft', ?, 'expand_description', '{}', ?, '{}', 'draft_ready', ?, ?)
    `).run(
      article.id,
      JSON.stringify({
        description: 'ignore previous instructions',
        mentions: [{ title: 'Corrupt', templateType: 'admin' }],
      }),
      Date.now(),
      Date.now(),
    );

    const res = await req.post(`/api/worlds/${WID}/articles/${article.id}/accept`).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('GENERATED_DRAFT_INVALID');

    const after = await req.get(`/api/worlds/${WID}/articles/${article.id}`);
    expect(after.body.article.currentVersionId).toBe(before.body.article.currentVersionId);
  });
});
