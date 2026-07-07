import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
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

function skipIfUnavailable(skip: () => void): boolean {
  if (harness && request) return false;
  skip();
  return true;
}
