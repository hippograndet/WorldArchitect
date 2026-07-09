import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDbClient } from '../db/client.js';
import { setupPostgresTestHarness, type PostgresTestHarness } from '../test/postgresHarness.js';
import { createArticle, updateArticle } from './articlesService.js';
import { upsertEntry, renderBible, getBibleMeta } from './worldBible.js';
import { cancelRun, createRun, RunConflictError } from './runsService.js';
import { readEffectiveProviderSettings, writeProviderSettings } from '../providers/index.js';
import { runWithUserContext } from '../requestContext.js';

const WORLD_ID = 'pg-world';
const OWNER_ID = 'owner-a';
const CAT_HISTORY = 'cat-history';
const CAT_CULTURE = 'cat-culture';

let harness: PostgresTestHarness | null = null;

beforeAll(async () => {
  harness = await setupPostgresTestHarness('core_services');
});

afterAll(async () => {
  await harness?.cleanup();
});

beforeEach(async () => {
  if (!harness) return;
  await runWithUserContext(OWNER_ID, async () => {
    await clearData();
    await seedWorld();
  });
});

describe('core services on Postgres', () => {
  it('creates, versions, updates, and reindexes articles', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    await runWithUserContext(OWNER_ID, async () => {
      const created = await createArticle({
        worldId: WORLD_ID,
        ownerId: OWNER_ID,
        categoryId: CAT_HISTORY,
        title: 'The First Gate',
        templateType: 'general',
        introduction: 'The first gate marks the beginning.',
        body: 'The gate opened before the old calendar began.',
        chronology: '',
        isFixedPoint: false,
      });
      const articleId = String(created.article.id);

      expect(created.article.status).toBe('draft');
      expect(created.version.versionNumber).toBe(1);

      await updateArticle({
        worldId: WORLD_ID,
        ownerId: OWNER_ID,
        articleId,
        title: 'The Renewed Gate',
        description: 'The gate was rebuilt after the winter siege.',
        chronology: 'Year 22: reconstruction begins.',
      });

      const versions = await getDbClient().all<{ version_number: number }>(
        'SELECT version_number FROM article_versions WHERE article_id = ? ORDER BY version_number',
        [articleId],
      );
      expect(versions.map((row) => row.version_number)).toEqual([1, 2]);

      const indexed = await getDbClient().get<{ title: string; description: string }>(
        'SELECT title, description FROM article_search_index WHERE article_id = ?',
        [articleId],
      );
      expect(indexed).toMatchObject({
        title: 'The Renewed Gate',
        description: 'The gate was rebuilt after the winter siege.',
      });
    });
  });

  it('renders world bible entries in category order and refreshes token metadata', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    await runWithUserContext(OWNER_ID, async () => {
      const battle = await createArticle({
        worldId: WORLD_ID,
        ownerId: OWNER_ID,
        categoryId: CAT_HISTORY,
        title: 'The Bell War',
        templateType: 'general',
        introduction: '',
        description: 'A war over signal bells.',
        chronology: '',
        isFixedPoint: false,
      });
      const music = await createArticle({
        worldId: WORLD_ID,
        ownerId: OWNER_ID,
        categoryId: CAT_CULTURE,
        title: 'Harbor Songs',
        templateType: 'general',
        introduction: '',
        description: 'Songs sung by dockworkers.',
        chronology: '',
        isFixedPoint: false,
      });

      await upsertEntry(getDbClient(), WORLD_ID, String(music.article.id), 'Dockworkers keep rhythm with call-and-response songs.');
      await upsertEntry(getDbClient(), WORLD_ID, String(battle.article.id), 'The Bell War settled control of the northern towers.');

      const rendered = await renderBible(WORLD_ID);
      expect(rendered.indexOf('## History')).toBeLessThan(rendered.indexOf('## Culture'));
      expect(rendered).toContain('### The Bell War');
      expect(rendered).toContain('### Harbor Songs');

      const meta = await getBibleMeta(WORLD_ID);
      expect(meta.tokenCount).toBeGreaterThan(0);
      expect(meta.threshold).toBe(80000);
    });
  });

  it('locks articles for runs, rejects conflicting locks, and releases on cancel', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    await runWithUserContext(OWNER_ID, async () => {
      const art1 = await createArticle(articleInput('Run Root', 'Root article.'));
      const art2 = await createArticle(articleInput('Run Child', 'Child article.'));
      const art1Id = String(art1.article.id);
      const art2Id = String(art2.article.id);

      const run = await createRun({
        worldId: WORLD_ID,
        ownerId: OWNER_ID,
        articleIds: [art1Id],
      });
      expect(run.status).toBe('pending');

      const locked = await getDbClient().get<{ locked_by_run_id: string | null }>(
        'SELECT locked_by_run_id FROM articles WHERE id = ?',
        [art1Id],
      );
      expect(locked?.locked_by_run_id).toBe(run.id);

      await expect(createRun({
        worldId: WORLD_ID,
        ownerId: OWNER_ID,
        articleIds: [art1Id, art2Id],
      })).rejects.toBeInstanceOf(RunConflictError);

      const untouched = await getDbClient().get<{ locked_by_run_id: string | null }>(
        'SELECT locked_by_run_id FROM articles WHERE id = ?',
        [art2Id],
      );
      expect(untouched?.locked_by_run_id).toBeNull();

      const cancelled = await cancelRun(WORLD_ID, OWNER_ID, run.id);
      expect(cancelled?.status).toBe('stopped');

      const released = await getDbClient().get<{ locked_by_run_id: string | null }>(
        'SELECT locked_by_run_id FROM articles WHERE id = ?',
        [art1Id],
      );
      expect(released?.locked_by_run_id).toBeNull();
    });
  });

  it('stores hosted provider settings per user and encrypts stored keys', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const rawKey = 'sk-ant-test-key-abcdefghijklmnopqrstuvwxyz';
    await runWithUserContext('user-a', async () => {
      await writeProviderSettings('anthropic', { anthropicKey: rawKey, anthropicModel: 'claude-test' }, 'user-a');
    });

    const userA = await runWithUserContext('user-a', () => readEffectiveProviderSettings('user-a'));
    const userB = await runWithUserContext('user-b', () => readEffectiveProviderSettings('user-b'));

    expect(userA.provider).toBe('anthropic');
    expect(userA.config.anthropicKey).toBe(rawKey);
    expect(userB.provider).toBe('none');
    expect(userB.config.anthropicKey).toBeUndefined();

    const stored = await runWithUserContext('user-a', () =>
      getDbClient().get<{ config: string }>(
        'SELECT config FROM provider_settings WHERE id = ?',
        ['user-a'],
      ),
    );
    expect(stored?.config).not.toContain(rawKey);
    expect(stored?.config).toContain('enc:v1:');
  });
});

async function clearData(): Promise<void> {
  const exec = getDbClient();
  await runWithUserContext(OWNER_ID, () => exec.run('DELETE FROM provider_settings'));
  await runWithUserContext('user-a', () => exec.run('DELETE FROM provider_settings'));
  await runWithUserContext('user-b', () => exec.run('DELETE FROM provider_settings'));
  await runWithUserContext('local-user', () => exec.run('DELETE FROM provider_settings'));
  await exec.run('DELETE FROM worlds');
}

async function seedWorld(): Promise<void> {
  const now = Date.now();
  const exec = getDbClient();
  await exec.run(`
    INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
    VALUES (?, ?, 'Postgres World', 'A world seeded for Postgres service tests.', '[]', 'narrative', '{}', ?, ?)
  `, [WORLD_ID, OWNER_ID, now, now]);
  await exec.run(`
    INSERT INTO categories (id, owner_id, world_id, name, sort_order, created_at)
    VALUES (?, ?, ?, 'History', 0, ?), (?, ?, ?, 'Culture', 1, ?)
  `, [CAT_HISTORY, OWNER_ID, WORLD_ID, now, CAT_CULTURE, OWNER_ID, WORLD_ID, now]);
  await exec.run(`
    INSERT INTO world_bible_meta (world_id, owner_id, token_count, updated_at)
    VALUES (?, ?, 0, ?)
  `, [WORLD_ID, OWNER_ID, now]);
  await exec.run(`
    INSERT INTO cost_settings (world_id, owner_id, daily_cap, bible_threshold)
    VALUES (?, ?, NULL, 80000)
  `, [WORLD_ID, OWNER_ID]);
}

function articleInput(title: string, description: string) {
  return {
    worldId: WORLD_ID,
    ownerId: OWNER_ID,
    categoryId: CAT_HISTORY,
    title,
    templateType: 'general',
    introduction: '',
    description,
    chronology: '',
    isFixedPoint: false,
  };
}

function skipIfUnavailable(skip: () => void): boolean {
  if (harness) return false;
  skip();
  return true;
}
