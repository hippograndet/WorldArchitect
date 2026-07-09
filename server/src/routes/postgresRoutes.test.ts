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
import { runWithUserContext } from '../requestContext.js';
import {
  asUser,
  createArticleFixture,
  createTenantFixture,
  expectCrossTenantMutationBlocked,
  expectOwnedRows,
  expectTenantHidden,
  expectTenantListExcludes,
} from '../test/tenantIsolation.js';

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

    const { world: worldA } = await createTenantFixture(request!, 'user-a', 'Aurelian Reach');
    const { world: worldB } = await createTenantFixture(request!, 'user-b', 'Boreal Archive');

    const listA = await request!
      .get('/api/worlds')
      .set(asUser('user-a'))
      .expect(200);
    expect(listA.body.map((world: { id: string }) => world.id)).toEqual([worldA.id]);

    await expectTenantHidden(request!, {
      method: 'get',
      path: `/api/worlds/${worldB.id}`,
      userId: 'user-a',
    });

    await request!
      .get(`/api/worlds/${worldB.id}`)
      .set(asUser('user-b'))
      .expect(200);

    const rlsState = await getDbClient().get<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'worlds'::regclass`,
    );
    expect(rlsState).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });

    const role = await getDbClient().get<{ bypasses_rls: boolean }>(
      `SELECT (rolsuper OR rolbypassrls) AS bypasses_rls FROM pg_roles WHERE rolname = current_user`,
    );
    if (!role?.bypasses_rls) {
      const hiddenByRls = await runWithUserContext('user-b', () =>
        getDbClient().get<{ id: string }>('SELECT id FROM worlds WHERE id = ?', [worldA.id]),
      );
      expect(hiddenByRls).toBeUndefined();

      await expect(runWithUserContext('user-b', () =>
        getDbClient().run(
          `INSERT INTO categories (id, owner_id, world_id, name, sort_order, created_at)
           VALUES (?, ?, ?, ?, 0, ?)`,
          ['forged-category', 'user-a', worldB.id, 'Forged Category', Date.now()],
        ),
      )).rejects.toThrow(/row-level security|violates/i);
    }
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

    const { world, categories } = await createTenantFixture(request!, 'user-a', 'Charter Isles');
    const { world: worldB } = await createTenantFixture(request!, 'user-b', 'Quiet Ledger');
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

    await expectTenantHidden(request!, {
      method: 'get',
      path: `/api/worlds/${world.id}/articles/${created.body.article.id}`,
      userId: 'user-b',
    });

    await expectTenantListExcludes<Array<{ id: string }>>(request!, {
      path: `/api/worlds/${worldB.id}/articles`,
      userId: 'user-b',
      hiddenId: created.body.article.id,
      extractIds: (body) => body.map((article) => article.id),
    });

    await expectTenantHidden(request!, {
      method: 'get',
      path: `/api/worlds/${worldB.id}/articles/${created.body.article.id}`,
      userId: 'user-b',
    });

    await expectCrossTenantMutationBlocked(request!, {
      method: 'patch',
      path: `/api/worlds/${worldB.id}/articles/${created.body.article.id}`,
      userId: 'user-b',
      body: { title: 'Borrowed Charter' },
    });
  });

  it('creates runs, preserves lock rollback on conflict, and releases locks on cancel', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const { world, categories } = await createTenantFixture(request!, 'user-a', 'Forge Coast');
    const { world: worldB } = await createTenantFixture(request!, 'user-b', 'Silent Foundry');
    const first = await createArticleFixture(request!, 'user-a', world.id, categories[0].id, 'Signal Tower');
    const second = await createArticleFixture(request!, 'user-a', world.id, categories[0].id, 'Mirror Gate');

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
      autonomyMode: 'auto_with_post_review',
      reviewPolicy: 'auto',
      commitPolicy: 'auto_commit',
    }));

    const runRow = await runWithUserContext('user-a', () =>
      getDbClient().get<{ owner_id: string; graph_type: string; run_config: string }>(
        'SELECT owner_id, graph_type, run_config FROM runs WHERE id = ?',
        [created.body.id],
      ),
    );
    expect(runRow?.owner_id).toBe('user-a');
    expect(runRow?.graph_type).toBe('expand');
    expect(JSON.parse(runRow?.run_config ?? '{}')).toEqual(expect.objectContaining({
      articleIds: [first.article.id],
      pipelineType: 'expand_description',
      startStep: 'expansion',
      autonomyMode: 'auto_with_post_review',
      reviewPolicy: 'auto',
      commitPolicy: 'auto_commit',
    }));
    await expectOwnedRows('runs', 'user-a', [created.body.id]);

    const locked = await runWithUserContext('user-a', () =>
      getDbClient().get<{ locked_by_run_id: string | null }>(
        'SELECT locked_by_run_id FROM articles WHERE id = ?',
        [first.article.id],
      ),
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

    const secondAfterConflict = await runWithUserContext('user-a', () =>
      getDbClient().get<{ locked_by_run_id: string | null }>(
        'SELECT locked_by_run_id FROM articles WHERE id = ?',
        [second.article.id],
      ),
    );
    expect(secondAfterConflict?.locked_by_run_id).toBeNull();

    await runWithUserContext('user-a', () =>
      getDbClient().run(
        `INSERT INTO run_events (id, run_id, step, title, ok, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [`event-${created.body.id}`, created.body.id, 'Test step', 'Tenant event', true, 'visible only to owner', Date.now()],
      ),
    );
    await runWithUserContext('user-a', () =>
      getDbClient().run(
        `INSERT INTO llm_traces
           (id, owner_id, world_id, run_id, article_id, agent_type, provider, iteration, status,
            request_json, response_json, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `trace-${created.body.id}`,
          'user-a',
          world.id,
          created.body.id,
          first.article.id,
          'lorekeeper',
          'groq',
          1,
          'error',
          '{"messages":[]}',
          null,
          '401 Invalid API Key',
          Date.now(),
        ],
      ),
    );
    await runWithUserContext('user-a', () =>
      getDbClient().run(
        `INSERT INTO run_review_items
           (id, owner_id, world_id, run_id, article_id, step, kind, status, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `review-${created.body.id}`,
          'user-a',
          world.id,
          created.body.id,
          first.article.id,
          'Inception',
          'intro_review',
          'pending',
          '{"introduction":"Review me."}',
          Date.now(),
          Date.now(),
        ],
      ),
    );

    const readRun = await request!
      .get(`/api/worlds/${world.id}/runs/${created.body.id}`)
      .set(asUser('user-a'))
      .expect(200);
    expect(readRun.body.events.map((event: { id: string }) => event.id)).toContain(`event-${created.body.id}`);
    expect(readRun.body.config).toEqual(expect.objectContaining({
      pipelineType: 'expand_description',
      startStep: 'expansion',
    }));
    expect(readRun.body.agentCalls).toEqual([]);
    expect(readRun.body.reviewItems.map((item: { id: string }) => item.id)).toContain(`review-${created.body.id}`);

    const previousTraceFlag = process.env.WORLDARCHITECT_LLM_TRACE;
    process.env.WORLDARCHITECT_LLM_TRACE = '1';
    try {
      const traces = await request!
        .get(`/api/worlds/${world.id}/runs/${created.body.id}/llm-traces`)
        .set(asUser('user-a'))
        .expect(200);
      expect(traces.body.map((trace: { id: string }) => trace.id)).toContain(`trace-${created.body.id}`);

      await expectTenantHidden(request!, {
        method: 'get',
        path: `/api/worlds/${worldB.id}/runs/${created.body.id}/llm-traces`,
        userId: 'user-b',
      });
      await expectTenantHidden(request!, {
        method: 'post',
        path: `/api/worlds/${worldB.id}/runs/${created.body.id}/review-items/review-${created.body.id}/decision`,
        userId: 'user-b',
        expectedStatuses: [404],
        body: { action: 'accept', decision: { introduction: 'Nope' } },
      });
    } finally {
      if (previousTraceFlag === undefined) {
        delete process.env.WORLDARCHITECT_LLM_TRACE;
      } else {
        process.env.WORLDARCHITECT_LLM_TRACE = previousTraceFlag;
      }
    }

    await expectTenantListExcludes<Array<{ id: string }>>(request!, {
      path: `/api/worlds/${worldB.id}/runs`,
      userId: 'user-b',
      hiddenId: created.body.id,
      extractIds: (body) => body.map((run) => run.id),
    });

    await expectTenantHidden(request!, {
      method: 'get',
      path: `/api/worlds/${worldB.id}/runs/${created.body.id}`,
      userId: 'user-b',
    });

    await expectCrossTenantMutationBlocked(request!, {
      method: 'post',
      path: `/api/worlds/${worldB.id}/runs/${created.body.id}/cancel`,
      userId: 'user-b',
    });

    const cancelled = await request!
      .post(`/api/worlds/${world.id}/runs/${created.body.id}/cancel`)
      .set(asUser('user-a'))
      .expect(200);
    expect(cancelled.body.status).toBe('stopped');

    const released = await runWithUserContext('user-a', () =>
      getDbClient().get<{ locked_by_run_id: string | null }>(
        'SELECT locked_by_run_id FROM articles WHERE id = ?',
        [first.article.id],
      ),
    );
    expect(released?.locked_by_run_id).toBeNull();

    const cleared = await request!
      .delete(`/api/worlds/${world.id}/runs`)
      .set(asUser('user-a'))
      .expect(200);
    expect(cleared.body).toEqual({ deleted: 1, retained: 0 });

    await request!
      .get(`/api/worlds/${world.id}/runs/${created.body.id}`)
      .set(asUser('user-a'))
      .expect(404);

    const assisted = await request!
      .post(`/api/worlds/${world.id}/runs`)
      .set(asUser('user-a'))
      .send({
        articleIds: [second.article.id],
        pipelineType: 'expand_description',
        validationLevel: 'assisted',
      })
      .expect(202);
    expect(forgeGraph.startForgeRun).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: assisted.body.id,
      autonomyMode: 'review_each_step',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
    }));

    await request!
      .post(`/api/worlds/${world.id}/runs/${assisted.body.id}/cancel`)
      .set(asUser('user-a'))
      .expect(200);
  });

  it('captures and restores snapshots on Postgres', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const { world, categories } = await createTenantFixture(request!, 'user-a', 'Archive Keys');
    const { world: worldB } = await createTenantFixture(request!, 'user-b', 'Blank Archive');
    const created = await createArticleFixture(request!, 'user-a', world.id, categories[0].id, 'Original Gate');
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

    const snapshotsB = await request!
      .get(`/api/worlds/${worldB.id}/snapshots`)
      .set(asUser('user-b'))
      .expect(200);
    expect(snapshotsB.body).toEqual([]);

    await expectTenantHidden(request!, {
      method: 'get',
      path: `/api/worlds/${worldB.id}/snapshots/${snapshot.body.id}`,
      userId: 'user-b',
    });

    await expectCrossTenantMutationBlocked(request!, {
      method: 'delete',
      path: `/api/worlds/${worldB.id}/snapshots/${snapshot.body.id}`,
      userId: 'user-b',
    });

    await expectCrossTenantMutationBlocked(request!, {
      method: 'post',
      path: `/api/worlds/${world.id}/snapshots/${snapshot.body.id}/restore`,
      userId: 'user-b',
    });

    await expectTenantHidden(request!, {
      method: 'get',
      path: `/api/worlds/${world.id}/export`,
      userId: 'user-b',
    });
  });

  it('isolates name bank and entity mention routes by tenant', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const { world: worldA, categories } = await createTenantFixture(request!, 'user-a', 'Lexicon Gate');
    const { world: worldB } = await createTenantFixture(request!, 'user-b', 'Empty Lexicon');
    const article = await createArticleFixture(request!, 'user-a', worldA.id, categories[0].id, 'Mention Source');

    const savedNames = await request!
      .post(`/api/worlds/${worldA.id}/names`)
      .set(asUser('user-a'))
      .send({
        names: [{
          name: 'Maris Vale',
          profileId: 'roman',
          entityType: 'person',
          tags: ['harbor'],
          source: 'user',
        }],
      })
      .expect(201);
    const nameId = savedNames.body.names[0].id;

    const namesA = await request!
      .get(`/api/worlds/${worldA.id}/names`)
      .set(asUser('user-a'))
      .expect(200);
    expect(namesA.body.names.map((name: { id: string }) => name.id)).toContain(nameId);

    await expectTenantListExcludes<{ names: Array<{ id: string }> }>(request!, {
      path: `/api/worlds/${worldB.id}/names`,
      userId: 'user-b',
      hiddenId: nameId,
      extractIds: (body) => body.names.map((name) => name.id),
    });

    await expectCrossTenantMutationBlocked(request!, {
      method: 'delete',
      path: `/api/worlds/${worldB.id}/names/${nameId}`,
      userId: 'user-b',
      expectedStatuses: [204],
    });

    const namesAfterDeleteAttempt = await request!
      .get(`/api/worlds/${worldA.id}/names`)
      .set(asUser('user-a'))
      .expect(200);
    expect(namesAfterDeleteAttempt.body.names.map((name: { id: string }) => name.id)).toContain(nameId);

    const mentionId = `mention-${article.article.id}`;
    await runWithUserContext('user-a', () =>
      getDbClient().run(
        `INSERT INTO entity_mentions
           (id, owner_id, world_id, source_article_id, article_id, title, template_type, summary, status, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'character', ?, 'created', ?)`,
        [mentionId, 'user-a', worldA.id, article.article.id, 'Maris Vale', 'A harbor pilot.', Date.now()],
      ),
    );

    const mentionsA = await request!
      .get(`/api/worlds/${worldA.id}/entity-mentions`)
      .set(asUser('user-a'))
      .expect(200);
    expect(mentionsA.body.map((mention: { id: string }) => mention.id)).toContain(mentionId);

    await expectTenantListExcludes<Array<{ id: string }>>(request!, {
      path: `/api/worlds/${worldB.id}/entity-mentions`,
      userId: 'user-b',
      hiddenId: mentionId,
      extractIds: (body) => body.map((mention) => mention.id),
    });

    await expectCrossTenantMutationBlocked(request!, {
      method: 'patch',
      path: `/api/worlds/${worldB.id}/entity-mentions/${mentionId}`,
      userId: 'user-b',
      body: { status: 'ignored' },
    });
  });
});

function skipIfUnavailable(skip: () => void): boolean {
  if (harness && request) return false;
  skip();
  return true;
}
