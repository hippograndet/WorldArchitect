import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { setupPostgresTestHarness, type PostgresTestHarness } from '../test/postgresHarness.js';
import { getDbClient } from '../db/client.js';
import { runWithUserContext } from '../requestContext.js';
import type { CompletionResult } from '../providers/types.js';

const completeMock = vi.hoisted(() => vi.fn<() => Promise<CompletionResult>>());

vi.mock('../providers/index.js', () => ({
  getProvider: async () => ({ name: 'anthropic', complete: completeMock, estimateTokens: async () => 0 }),
}));

vi.mock('./callLogger.js', () => ({
  logCall: vi.fn(),
}));

import { acceptEntityMention, scanEntityMentions } from './entityMentionService.js';

const OWNER_ID = 'owner-entity-mentions-test';

let harness: PostgresTestHarness | null = null;

beforeAll(async () => {
  harness = await setupPostgresTestHarness('entity_mentions');
});

afterAll(async () => {
  await harness?.cleanup();
});

beforeEach(() => {
  completeMock.mockReset();
});

function toolUseResult(name: string, input: Record<string, unknown>): CompletionResult {
  return {
    content: '',
    tokensIn: 10,
    tokensOut: 5,
    stopReason: 'tool_use',
    toolCalls: [{ id: `call-${name}`, name, input }],
  };
}

async function seedWorldAndArticle() {
  const db = getDbClient();
  const worldId = `mentions-world-${nanoid(6)}`;
  const articleId = `mentions-article-${nanoid(6)}`;
  const versionId = `mentions-version-${nanoid(6)}`;

  await db.run(
    `INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
     VALUES (?, ?, 'Mention World', 'desc', '[]', 'narrative', '{}', 0, 0)`,
    [worldId, OWNER_ID],
  );
  await db.run(
    `INSERT INTO articles (id, owner_id, world_id, title, status, template_type, depth, current_version_id, created_at, updated_at)
     VALUES (?, ?, ?, 'Source Article', 'draft', 'general', 2, ?, 0, 0)`,
    [articleId, OWNER_ID, worldId, versionId],
  );
  await db.run(
    `INSERT INTO article_versions
       (id, article_id, owner_id, version_number, introduction, description, chronology, word_count, created_at)
     VALUES (?, ?, ?, 1, 'Intro.', 'The Glass Ford shines beneath stormlight.', '', 7, 0)`,
    [versionId, articleId, OWNER_ID],
  );

  return { worldId, articleId };
}

describe('entity mention consolidation service', () => {
  it('scans accepted prose into pending candidates without creating articles', async () => {
    const { worldId, articleId } = await seedWorldAndArticle();
    completeMock.mockResolvedValueOnce(toolUseResult('submit_mentions', {
      mentions: [{ title: 'The Glass Ford', templateType: 'location', summary: 'A sacred river crossing made of stormglass.' }],
    }));

    const result = await runWithUserContext(OWNER_ID, () =>
      scanEntityMentions({ worldId, ownerId: OWNER_ID, articleId }),
    );

    expect(result).toMatchObject({ scannedArticles: 1, created: 1 });
    expect(result.mentions[0]).toMatchObject({ title: 'The Glass Ford', status: 'pending', articleId: null });

    const createdArticle = await getDbClient().get(
      'SELECT id FROM articles WHERE world_id = ? AND owner_id = ? AND title = ?',
      [worldId, OWNER_ID, 'The Glass Ford'],
    );
    expect(createdArticle).toBeUndefined();
  });

  it('accepts a pending candidate by creating a same-depth referenced stub', async () => {
    const { worldId, articleId } = await seedWorldAndArticle();
    const mentionId = `mention-${nanoid(6)}`;
    await getDbClient().run(
      `INSERT INTO entity_mentions
         (id, owner_id, world_id, source_article_id, article_id, title, template_type, summary, status, created_at)
       VALUES (?, ?, ?, ?, NULL, 'The Glass Ford', 'location', 'A sacred river crossing made of stormglass.', 'pending', 0)`,
      [mentionId, OWNER_ID, worldId, articleId],
    );

    const accepted = await runWithUserContext(OWNER_ID, () =>
      acceptEntityMention({ worldId, ownerId: OWNER_ID, mentionId }),
    );

    expect(accepted).toMatchObject({ title: 'The Glass Ford', status: 'created' });
    expect(accepted.articleId).toBeTruthy();

    const article = await getDbClient().get<{ depth: number; status: string }>(
      'SELECT depth, status FROM articles WHERE id = ? AND owner_id = ?',
      [accepted.articleId, OWNER_ID],
    );
    expect(article).toEqual({ depth: 2, status: 'stub' });

    const link = await getDbClient().get(
      `SELECT source_article_id FROM article_links
       WHERE source_article_id = ? AND target_article_id = ? AND owner_id = ? AND link_type = 'references'`,
      [articleId, accepted.articleId, OWNER_ID],
    );
    expect(link).toBeTruthy();
  });
});
