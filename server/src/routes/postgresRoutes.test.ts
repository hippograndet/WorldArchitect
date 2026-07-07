import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';

const forgeGraph = vi.hoisted(() => ({
  startForgeRun: vi.fn().mockResolvedValue(undefined),
  resumeForgeRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../agents/graphs/forgeGraph.js', () => forgeGraph);

import { createApp } from '../app.js';
import { getDbClient } from '../db/client.js';
import { setupPostgresTestHarness, type PostgresTestHarness } from '../test/postgresHarness.js';

let harness: PostgresTestHarness | null = null;
let request: ReturnType<typeof supertest> | null = null;

beforeAll(async () => {
  harness = await setupPostgresTestHarness('routes');
  if (!harness) return;
  request = supertest(createApp());
});

afterAll(async () => {
  await harness?.cleanup();
});

describe('core routes on Postgres', () => {
  it('creates worlds and enforces hosted tenant isolation', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const { world: worldA } = await createWorld('user-a', 'Aurelian Reach');
    const { world: worldB } = await createWorld('user-b', 'Boreal Archive');

    const listA = await request!
      .get('/api/worlds')
      .set(asUser('user-a'))
      .expect(200);
    expect(listA.body.map((world: { id: string }) => world.id)).toEqual([worldA.id]);

    await request!
      .get(`/api/worlds/${worldB.id}`)
      .set(asUser('user-a'))
      .expect(404);

    await request!
      .get(`/api/worlds/${worldB.id}`)
      .set(asUser('user-b'))
      .expect(200);
  });

  it('stores provider settings per hosted user and masks keys', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const rawKey = 'sk-ant-test-key-abcdefghijklmnopqrstuvwxyz';
    await request!
      .patch('/api/settings')
      .set(asUser('user-a'))
      .send({ provider: 'anthropic', apiKey: rawKey, model: 'claude-test' })
      .expect(200);

    const userA = await request!
      .get('/api/settings')
      .set(asUser('user-a'))
      .expect(200);
    const userB = await request!
      .get('/api/settings')
      .set(asUser('user-b'))
      .expect(200);

    expect(userA.body.provider).toBe('anthropic');
    expect(userA.body.anthropic.keySet).toBe(true);
    expect(JSON.stringify(userA.body)).not.toContain(rawKey);
    expect(userB.body.provider).toBe('none');
    expect(userB.body.anthropic.keySet).toBe(false);
  });

  it('creates and reads articles under the world tenant guard', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const { world, categories } = await createWorld('user-a', 'Charter Isles');
    const categoryId = categories[0].id;

    const created = await request!
      .post(`/api/worlds/${world.id}/articles`)
      .set(asUser('user-a'))
      .send({
        categoryId,
        title: 'Harbor Charter',
        introduction: 'The first harbor charter defines island trade.',
        description: 'The charter binds the ferry guilds to common law.',
        chronology: 'Year 4: signed under storm lanterns.',
      })
      .expect(201);

    expect(created.body.article.title).toBe('Harbor Charter');
    expect(created.body.version.versionNumber).toBe(1);

    const read = await request!
      .get(`/api/worlds/${world.id}/articles/${created.body.article.id}`)
      .set(asUser('user-a'))
      .expect(200);
    expect(read.body.article.title).toBe('Harbor Charter');
    expect(read.body.version.description).toContain('ferry guilds');

    await request!
      .get(`/api/worlds/${world.id}/articles/${created.body.article.id}`)
      .set(asUser('user-b'))
      .expect(404);
  });

  it('creates runs, preserves lock rollback on conflict, and releases locks on cancel', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const { world, categories } = await createWorld('user-a', 'Forge Coast');
    const first = await createArticle('user-a', world.id, categories[0].id, 'Signal Tower');
    const second = await createArticle('user-a', world.id, categories[0].id, 'Mirror Gate');

    const created = await request!
      .post(`/api/worlds/${world.id}/runs`)
      .set(asUser('user-a'))
      .send({
        articleIds: [first.article.id],
        pipelineType: 'expand_description',
      })
      .expect(202);

    expect(created.body.status).toBe('pending');
    expect(created.body.articleIds).toEqual([first.article.id]);
    expect(forgeGraph.startForgeRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: created.body.id,
      worldId: world.id,
      ownerId: 'user-a',
      articleId: first.article.id,
      articleTitle: 'Signal Tower',
    }));

    const locked = await getDbClient().get<{ locked_by_run_id: string | null }>(
      'SELECT locked_by_run_id FROM articles WHERE id = ?',
      [first.article.id],
    );
    expect(locked?.locked_by_run_id).toBe(created.body.id);

    const conflict = await request!
      .post(`/api/worlds/${world.id}/runs`)
      .set(asUser('user-a'))
      .send({
        articleIds: [first.article.id, second.article.id],
        pipelineType: 'expand_description',
      })
      .expect(409);
    expect(conflict.body.code).toBe('ARTICLE_LOCKED');

    const secondAfterConflict = await getDbClient().get<{ locked_by_run_id: string | null }>(
      'SELECT locked_by_run_id FROM articles WHERE id = ?',
      [second.article.id],
    );
    expect(secondAfterConflict?.locked_by_run_id).toBeNull();

    const cancelled = await request!
      .post(`/api/worlds/${world.id}/runs/${created.body.id}/cancel`)
      .set(asUser('user-a'))
      .expect(200);
    expect(cancelled.body.status).toBe('stopped');

    const released = await getDbClient().get<{ locked_by_run_id: string | null }>(
      'SELECT locked_by_run_id FROM articles WHERE id = ?',
      [first.article.id],
    );
    expect(released?.locked_by_run_id).toBeNull();
  });

  it('captures and restores snapshots on Postgres', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const { world, categories } = await createWorld('user-a', 'Archive Keys');
    const created = await createArticle('user-a', world.id, categories[0].id, 'Original Gate');
    const articleId = created.article.id;

    const snapshot = await request!
      .post(`/api/worlds/${world.id}/snapshots`)
      .set(asUser('user-a'))
      .send({ name: 'Before edits' })
      .expect(201);

    await request!
      .patch(`/api/worlds/${world.id}/articles/${articleId}`)
      .set(asUser('user-a'))
      .send({
        title: 'Changed Gate',
        description: 'The record has been overwritten.',
      })
      .expect(200);

    await request!
      .post(`/api/worlds/${world.id}/snapshots/${snapshot.body.id}/restore`)
      .set(asUser('user-a'))
      .expect(200);

    const restored = await request!
      .get(`/api/worlds/${world.id}/articles/${articleId}`)
      .set(asUser('user-a'))
      .expect(200);
    expect(restored.body.article.title).toBe('Original Gate');
    expect(restored.body.version.description).toBe('The old gate records the first treaty.');

    const snapshots = await request!
      .get(`/api/worlds/${world.id}/snapshots`)
      .set(asUser('user-a'))
      .expect(200);
    expect(snapshots.body.map((row: { name: string }) => row.name)).toContain('Before edits');
    expect(snapshots.body.some((row: { name: string }) => row.name.startsWith('Auto-save before restore'))).toBe(true);

    await request!
      .post(`/api/worlds/${world.id}/snapshots/${snapshot.body.id}/restore`)
      .set(asUser('user-b'))
      .expect(404);
  });
});

function asUser(userId: string) {
  return { 'x-worldarchitect-user-id': userId };
}

async function createWorld(
  userId: string,
  name: string,
): Promise<{ world: { id: string; name: string }; categories: Array<{ id: string; name: string }> }> {
  const res = await request!
    .post('/api/worlds')
    .set(asUser(userId))
    .send({
      name,
      description: `A long enough description for ${name}.`,
    })
    .expect(201);
  return { world: res.body.world, categories: res.body.categories };
}

async function createArticle(
  userId: string,
  worldId: string,
  categoryId: string,
  title: string,
): Promise<{ article: { id: string; title: string }; version: { description: string } }> {
  const res = await request!
    .post(`/api/worlds/${worldId}/articles`)
    .set(asUser(userId))
    .send({
      categoryId,
      title,
      introduction: 'A short archive note.',
      description: 'The old gate records the first treaty.',
      chronology: 'Year 1: the treaty is signed.',
    })
    .expect(201);
  return res.body;
}

function skipIfUnavailable(skip: () => void): boolean {
  if (harness && request) return false;
  skip();
  return true;
}
