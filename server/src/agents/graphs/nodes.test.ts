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
import { wardenNode, fetchWorldContextNode, buildContextPackageNode, scribeNode } from './nodes.js';

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

function genericToolUseResult(name: string, input: Record<string, unknown>): CompletionResult {
  return {
    content: '',
    tokensIn: 10,
    tokensOut: 5,
    stopReason: 'tool_use',
    toolCalls: [{ id: `call-${name}`, name, input }],
  };
}

function textResult(content: string): CompletionResult {
  return {
    content,
    tokensIn: 10,
    tokensOut: 5,
    stopReason: 'end_turn',
  };
}

function scribeState(overrides: Partial<OrchestrationState> = {}): OrchestrationState {
  return {
    worldId: 'scribe-node-world',
    articleId: 'scribe-node-article',
    pipelineRunId: 'scribe-node-run',
    pipelineType: 'expand',
    contextPackage: {
      targetId: 'scribe-node-article',
      targetTitle: 'Scribe Article',
      targetTemplateType: 'general',
      targetDescription: '',
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
      worldId: 'scribe-node-world',
      name: 'Scribe World',
      tone: 'narrative',
      originPoint: null,
      styleConfig: null,
    },
    expanderMode: 'expand_description',
    selectedProposal: { title: 'Proposal', direction: 'Develop the article.' },
    runContinuityEditor: false,
    wordCountPreset: 'medium',
    ...overrides,
  } as unknown as OrchestrationState;
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

describe('fetchWorldContextNode caching guard', () => {
  it('fetches and returns worldContext when none is cached', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      await seedWorldWithBibleEntries('fetch-world-context-miss', 0);

      const result = await fetchWorldContextNode({
        worldId: 'fetch-world-context-miss',
        worldContext: undefined,
      } as unknown as OrchestrationState);

      expect(result.worldContext).toMatchObject({ worldId: 'fetch-world-context-miss', name: 'Test World' });
    });
  });

  it('skips the fetch (never touches the DB) when worldContext is already cached', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      // Bogus worldId — fetchWorldContext() would throw "World ... not found"
      // if the guard didn't short-circuit before reaching the DB.
      const result = await fetchWorldContextNode({
        worldId: 'this-world-id-does-not-exist',
        worldContext: { worldId: 'cached', name: 'Cached World', tone: 'narrative', originPoint: null, styleConfig: null },
      } as unknown as OrchestrationState);

      expect(result).toEqual({});
    });
  });
});

describe('buildContextPackageNode caching guard', () => {
  it('builds and returns contextPackage when none is cached', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      await seedWorldWithBibleEntries('build-context-package-miss', 1);

      const result = await buildContextPackageNode({
        worldId: 'build-context-package-miss',
        articleId: 'build-context-package-miss-article-0',
        contextPackage: undefined,
        contextMode: 'default',
        contextDepth: 'mid',
      } as unknown as OrchestrationState);

      expect(result.contextPackage).toMatchObject({ targetId: 'build-context-package-miss-article-0', targetTitle: 'Article 0' });
    });
  });

  it('skips the build (never touches the DB) when contextPackage is already cached', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      // Bogus articleId — buildContextPackage() would throw "Article ... not
      // found" if the guard didn't short-circuit before reaching the DB.
      const result = await buildContextPackageNode({
        worldId: 'build-context-package-guard',
        articleId: 'this-article-id-does-not-exist',
        contextPackage: { targetId: 'cached', targetTitle: 'Cached Article' } as unknown as OrchestrationState['contextPackage'],
        contextMode: 'default',
        contextDepth: 'mid',
      } as unknown as OrchestrationState);

      expect(result).toEqual({});
    });
  });
});

describe('scribeNode free-text drafting', () => {
  it('continues with empty mentions when mention extraction fails', async () => {
    completeMock
      .mockResolvedValueOnce(textResult('A generated description without structured mentions.'))
      .mockRejectedValueOnce(new Error('extractor failed'));

    const result = await scribeNode(scribeState());

    expect(result.description).toBe('A generated description without structured mentions.');
    expect(result.mentions).toEqual([]);
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it('reruns Scribe in free-text mode for continuity corrections', async () => {
    completeMock
      .mockResolvedValueOnce(textResult('A draft with a contradiction.'))
      .mockResolvedValueOnce(genericToolUseResult('submit_continuity_check', {
        approved: false,
        contradictions: [{ excerpt: 'contradiction', issue: 'Wrong fact', correction: 'Correct it' }],
      }))
      .mockResolvedValueOnce(textResult('A corrected draft.'))
      .mockResolvedValueOnce(genericToolUseResult('submit_continuity_check', {
        approved: true,
        contradictions: [],
      }))
      .mockResolvedValueOnce(genericToolUseResult('submit_mentions', { mentions: [] }));

    const result = await scribeNode(scribeState({
      runContinuityEditor: true,
      researchBrief: { keyFacts: ['A fact.'], warnings: [], suggestedAngles: [] },
    }));

    expect(result.description).toBe('A corrected draft.');
    expect(result.continuityCheck).toMatchObject({ approved: true });
    expect(completeMock).toHaveBeenCalledTimes(5);
  });
});
