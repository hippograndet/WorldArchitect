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
// APP_MODE/DATABASE_URL — these node modules only touch getDbClient() lazily
// inside each function call, so a static import here is safe.
import { wardenNode } from './nodes/consolidate/cohere.js';
import { fetchWorldContextNode, buildContextPackageNode } from './nodes/shared.js';
import { researcherNode } from './nodes/expand/research.js';
import { scribeNode } from './nodes/expand/draft.js';

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
    coherenceCheckLevel: 0,
    safetyNet: false,
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

describe('researcherNode caching guard', () => {
  it('runs Researcher and returns a researchBrief when none is cached', async () => {
    completeMock.mockResolvedValueOnce(genericToolUseResult('submit_research_brief', {
      brief: 'A fact about the article, established in the world context. An angle worth exploring further in the description.',
    }));

    const result = await researcherNode(scribeState({ researchBrief: undefined }));

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.researchBrief).toContain('A fact about the article');
  });

  it('skips the LLM call when researchBrief was already supplied externally', async () => {
    const result = await researcherNode(scribeState({
      researchBrief: 'Already known facts and an already known angle worth exploring.',
    }));

    expect(completeMock).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});

describe('scribeNode free-text drafting', () => {
  it('does not run mention extraction during expansion drafting', async () => {
    completeMock.mockResolvedValueOnce(textResult('A generated description without structured mentions.'));

    const result = await scribeNode(scribeState());

    expect(result.description).toBe('A generated description without structured mentions.');
    expect(result.mentions).toEqual([]);
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it('gives Scribe one revision attempt when Continuity Editor flags a contradiction, without re-checking the revision', async () => {
    completeMock
      .mockResolvedValueOnce(textResult('A draft with a contradiction.'))
      .mockResolvedValueOnce(genericToolUseResult('submit_continuity_check', {
        approved: false,
        contradictions: [{ excerpt: 'contradiction', issue: 'Wrong fact', correction: 'Correct it' }],
      }))
      .mockResolvedValueOnce(textResult('A corrected draft.'));

    const result = await scribeNode(scribeState({
      coherenceCheckLevel: 1,
      researchBrief: 'A fact established in the world context that the draft must respect.',
    }));

    // The revision is trusted without a second Continuity Editor call —
    // continuityCheck still reflects the one check that ran (which flagged
    // the original draft), even though `description` is the revised text.
    expect(result.description).toBe('A corrected draft.');
    expect(result.continuityCheck).toMatchObject({ approved: false });
    expect(completeMock).toHaveBeenCalledTimes(3);
  });

  it('at coherenceCheckLevel 2, runs a second check-revise cycle when the first revision is still flagged', async () => {
    completeMock
      .mockResolvedValueOnce(textResult('Draft one.'))
      .mockResolvedValueOnce(genericToolUseResult('submit_continuity_check', {
        approved: false,
        contradictions: [{ excerpt: 'one', issue: 'Wrong fact one', correction: 'Fix one' }],
      }))
      .mockResolvedValueOnce(textResult('Draft two.'))
      .mockResolvedValueOnce(genericToolUseResult('submit_continuity_check', {
        approved: false,
        contradictions: [{ excerpt: 'two', issue: 'Wrong fact two', correction: 'Fix two' }],
      }))
      .mockResolvedValueOnce(textResult('Draft three.'));

    const result = await scribeNode(scribeState({
      coherenceCheckLevel: 2,
      researchBrief: 'A fact established in the world context that the draft must respect.',
    }));

    // Two full check-revise cycles ran; the second revision is trusted without a third check.
    expect(result.description).toBe('Draft three.');
    expect(result.continuityCheck).toMatchObject({ approved: false });
    expect(completeMock).toHaveBeenCalledTimes(5);
  });

  it('stops early when a check approves before using the full coherenceCheckLevel budget', async () => {
    completeMock
      .mockResolvedValueOnce(textResult('A clean draft.'))
      .mockResolvedValueOnce(genericToolUseResult('submit_continuity_check', {
        approved: true,
        contradictions: [],
      }));

    const result = await scribeNode(scribeState({
      coherenceCheckLevel: 3,
      researchBrief: 'A fact established in the world context that the draft must respect.',
    }));

    expect(result.description).toBe('A clean draft.');
    expect(result.continuityCheck).toMatchObject({ approved: true });
    expect(completeMock).toHaveBeenCalledTimes(2);
  });
});
