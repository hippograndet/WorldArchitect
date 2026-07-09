import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPostgresTestHarness, type PostgresTestHarness } from '../../test/postgresHarness.js';
import { getDbClient } from '../../db/client.js';
import { runWithUserContext } from '../../requestContext.js';
import type { CompletionResult } from '../../providers/types.js';
import type { OrchestrationState } from './state.js';

const completeMock = vi.hoisted(() => vi.fn<() => Promise<CompletionResult>>());

vi.mock('../../providers/index.js', () => ({
  getProvider: async () => ({ name: 'anthropic', complete: completeMock, estimateTokens: async () => 0 }),
}));

vi.mock('../../services/callLogger.js', () => ({
  logCall: vi.fn(),
}));

// Import after the mocks above are registered, and after the harness sets
// APP_MODE/DATABASE_URL — nodes.js only touches getDbClient() lazily inside
// each function call, so a static import here is safe.
import { wardenNode } from './nodes.js';

const OWNER_ID = 'owner-warden-node-test';

let harness: PostgresTestHarness | null = null;

beforeAll(async () => {
  harness = await setupPostgresTestHarness('warden_sparse');
});

afterAll(async () => {
  await harness?.cleanup();
});

beforeEach(() => {
  completeMock.mockReset();
});

/** Seeds a world with N articles, each backed by a world_bible_entries row with a non-empty summary. */
async function seedWorldWithBibleEntries(worldId: string, nonEmptySummaryCount: number): Promise<void> {
  const db = getDbClient();
  await db.run(
    `INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
     VALUES (?, ?, 'Test World', 'desc', '[]', 'narrative', '{}', 0, 0)`,
    [worldId, OWNER_ID],
  );
  for (let i = 0; i < nonEmptySummaryCount; i++) {
    const articleId = `${worldId}-article-${i}`;
    await db.run(
      `INSERT INTO articles (id, owner_id, world_id, title, status, template_type, depth, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', 'general', 1, 0, 0)`,
      [articleId, OWNER_ID, worldId, `Article ${i}`],
    );
    await db.run(
      `INSERT INTO world_bible_entries (id, owner_id, world_id, article_id, summary, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [`${articleId}-bible`, OWNER_ID, worldId, articleId, `Summary for article ${i}`, i],
    );
  }
}

function toolUseResult(input: Record<string, unknown>): CompletionResult {
  return {
    content: '',
    tokensIn: 10,
    tokensOut: 5,
    stopReason: 'tool_use',
    toolCalls: [{ id: 'call-1', name: 'submit_coherence_check', input }],
  };
}

describe('wardenNode sparse-world guard (hasSufficientBibleContent)', () => {
  it('skips the LLM call and returns no warnings when the bible has under 5 entries', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      await seedWorldWithBibleEntries('warden-sparse-world', 4);

      const result = await wardenNode({ worldId: 'warden-sparse-world' } as unknown as OrchestrationState);

      expect(result).toEqual({ warnings: [], suggestedLinks: [] });
      expect(completeMock).not.toHaveBeenCalled();
    });
  });

  it('runs Warden once the bible has 5 or more entries', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      await seedWorldWithBibleEntries('warden-full-world', 5);
      completeMock.mockResolvedValueOnce(toolUseResult({
        warnings: [{ severity: 'warning', description: 'test warning', sourceArticleId: null }],
        suggestedLinks: [],
      }));

      const result = await wardenNode({
        worldId: 'warden-full-world',
        contextPackage: {
          targetId: 'a1',
          targetTitle: 'Article',
          targetTemplateType: 'general',
          targetDescription: 'body',
          targetChronology: '',
          targetIntroduction: '',
          parents: [],
          siblings: [],
          children: [],
          fixedPoints: [],
          temporalNeighbors: [],
          referencedArticles: [],
          estimatedTokens: 10,
        },
        worldContext: {
          worldId: 'warden-full-world',
          name: 'Test World',
          tone: 'narrative',
          originPoint: null,
          styleConfig: null,
        },
      } as unknown as OrchestrationState);

      expect(completeMock).toHaveBeenCalledTimes(1);
      expect(result.warnings).toHaveLength(1);
    });
  });
});
