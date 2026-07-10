import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { setupPostgresTestHarness, type PostgresTestHarness } from '../../test/postgresHarness.js';
import { getDbClient } from '../../db/client.js';
import { runWithUserContext } from '../../requestContext.js';
import type { CompletionResult } from '../../providers/types.js';
import type { ForgeState } from './forgeState.js';

const completeMock = vi.hoisted(() => vi.fn<() => Promise<CompletionResult>>());
const buildContextPackageCalls = vi.hoisted(() => vi.fn());
const fetchWorldContextCalls = vi.hoisted(() => vi.fn());

vi.mock('../../providers/index.js', () => ({
  getProvider: async () => ({ name: 'anthropic', complete: completeMock, estimateTokens: async () => 0 }),
}));

vi.mock('../../services/callLogger.js', () => ({
  logCall: vi.fn(),
}));

// Wraps the real implementations with a call-counting vi.fn so assertions
// below can prove the caching guards actually short-circuit, without
// reimplementing buildContextPackage/fetchWorldContext's DB logic.
vi.mock('../../services/archivist.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/archivist.js')>();
  return {
    ...actual,
    buildContextPackage: async (...args: Parameters<typeof actual.buildContextPackage>) => {
      buildContextPackageCalls(...args);
      return actual.buildContextPackage(...args);
    },
  };
});

vi.mock('../director.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../director.js')>();
  return {
    ...actual,
    fetchWorldContext: async (...args: Parameters<typeof actual.fetchWorldContext>) => {
      fetchWorldContextCalls(...args);
      return actual.fetchWorldContext(...args);
    },
  };
});

// Import after the mocks above are registered.
import { dequeueNode, inceptionNode, expansionNode, routeAfterExpansion } from './forgeGraph.js';

const OWNER_ID = 'owner-forge-graph-test';

let harness: PostgresTestHarness | null = null;

beforeAll(async () => {
  harness = await setupPostgresTestHarness('forge_graph');
});

afterAll(async () => {
  await harness?.cleanup();
});

beforeEach(() => {
  completeMock.mockReset();
  buildContextPackageCalls.mockClear();
  fetchWorldContextCalls.mockClear();
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

function textResult(content: string): CompletionResult {
  return {
    content,
    tokensIn: 10,
    tokensOut: 5,
    stopReason: 'end_turn',
  };
}

async function seedWorldAndArticleAndRun(worldId: string, articleId: string, runId: string): Promise<void> {
  const db = getDbClient();
  const now = Date.now();
  await db.run(
    `INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
     VALUES (?, ?, 'Test World', 'desc', '[]', 'narrative', '{}', ?, ?)`,
    [worldId, OWNER_ID, now, now],
  );
  await db.run(
    `INSERT INTO articles (id, owner_id, world_id, title, status, template_type, depth, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', 'general', 1, ?, ?)`,
    [articleId, OWNER_ID, worldId, 'Test Article', now, now],
  );
  await db.run(
    `INSERT INTO runs (id, owner_id, world_id, status, graph_type, checkpoint_id, article_ids, created_at, updated_at)
     VALUES (?, ?, ?, 'running', 'forge', ?, ?, ?, ?)`,
    [runId, OWNER_ID, worldId, runId, JSON.stringify([articleId]), now, now],
  );
}

/** Fully populated ForgeState — node functions are called directly here (not via graph.invoke()), so no Annotation defaults apply; every field must be supplied. */
function baseForgeState(overrides: Partial<ForgeState>): ForgeState {
  return {
    worldId: '',
    runId: '',
    ownerId: '',
    worldContext: undefined,
    contextDepth: 'mid',
    branchingMode: 'conceptual',
    forgeMode: 'breadth',
    forgeMaxDepth: 2,
    forgeMaxChildren: 0,
    forgeUseOracle: false,
    forgeUseContinuityEditor: false,
    forgeUseGroundingCheck: false,
    forgeUseDedupCheck: false,
    forgeContinuationMode: 'recursive',
    forgeInceptionExistingMode: 'improve',
    forgeExpansionExistingMode: 'improve',
    forgeBranchingExistingMode: 'append_deduped',
    masContract: undefined,
    masLocation: undefined,
    masIntent: undefined,
    autonomyMode: 'auto_with_post_review',
    reviewPolicy: 'auto',
    // pending_draft (not auto_commit) keeps this test from also exercising
    // acceptDraft()'s version-write path — out of scope for a caching test.
    commitPolicy: 'pending_draft',
    queue: [],
    currentItem: undefined,
    inceptionIntro: undefined,
    currentItemContextPackage: undefined,
    currentItemStepsDone: [],
    completed: 0,
    total: 0,
    failedItemCount: 0,
    signal: undefined,
    lastStepError: undefined,
    ...overrides,
  } as ForgeState;
}

describe('forgeGraph context caching', () => {
  it('reuses one cached WorldContext + ContextPackage across inceptionNode and expansionNode for one queue item', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      const worldId = `forge-ctx-world-${nanoid(6)}`;
      const articleId = `forge-ctx-article-${nanoid(6)}`;
      const runId = `forge-ctx-run-${nanoid(6)}`;
      await seedWorldAndArticleAndRun(worldId, articleId, runId);

      const worldContext = { worldId, name: 'Test World', tone: 'narrative', originPoint: null, styleConfig: null };

      completeMock
        .mockResolvedValueOnce(toolUseResult('submit_introduction', {
          introduction: 'A long and detailed introduction paragraph with plenty of descriptive words to pass the minimum word count check easily.',
        }))
        .mockResolvedValueOnce(toolUseResult('submit_proposals', {
          proposals: [{ title: 'A Proposal', direction: 'Explore a bold new direction for this article.' }],
        }))
        .mockResolvedValueOnce(toolUseResult('submit_taste_selection', {
          selectedIndex: 0,
          rationale: 'Best fit for the article.',
        }))
        .mockResolvedValueOnce(toolUseResult('submit_research_brief', {
          keyFacts: ['Fact one about the article.'],
          suggestedAngles: ['An angle to explore.'],
        }))
        .mockResolvedValueOnce(textResult('A freshly generated description for the article, written by Scribe during this test run.'))
        .mockResolvedValueOnce(toolUseResult('submit_mentions', { mentions: [] }));

      const item = { articleId, title: 'Test Article', depth: 0, startStep: 'inception' as const };

      const dequeueResult = await dequeueNode(baseForgeState({ worldId, runId, ownerId: OWNER_ID, worldContext, queue: [item] }));
      expect(dequeueResult.signal).toBe('continue');

      const stateAfterDequeue = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext,
        currentItem: dequeueResult.currentItem,
        queue: dequeueResult.queue ?? [],
        currentItemStepsDone: dequeueResult.currentItemStepsDone ?? [],
      });

      const inceptionResult = await inceptionNode(stateAfterDequeue);
      expect(inceptionResult.currentItemStepsDone).toContain('inception');
      expect(inceptionResult.currentItemContextPackage).toBeDefined();
      expect(inceptionResult.currentItemContextPackage?.targetIntroduction).toContain('long and detailed introduction');

      // Inception built exactly one ContextPackage (inside runSummarizeGraph);
      // worldContext was already cached in state, so it was never re-fetched.
      expect(buildContextPackageCalls).toHaveBeenCalledTimes(1);
      expect(fetchWorldContextCalls).not.toHaveBeenCalled();

      const stateAfterInception = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext,
        currentItem: stateAfterDequeue.currentItem,
        queue: stateAfterDequeue.queue,
        inceptionIntro: inceptionResult.inceptionIntro,
        currentItemContextPackage: inceptionResult.currentItemContextPackage,
        currentItemStepsDone: inceptionResult.currentItemStepsDone ?? [],
      });

      const expansionResult = await expansionNode(stateAfterInception);
      expect(expansionResult.currentItemStepsDone).toContain('expansion');

      // expansionNode reuses Inception's cached package across all of its
      // internal sub-pipeline calls (Muse/Curator, Researcher/Scribe) instead
      // of rebuilding — so the total call count across both nodes stays at 1.
      expect(buildContextPackageCalls).toHaveBeenCalledTimes(1);
      expect(fetchWorldContextCalls).not.toHaveBeenCalled();
      expect(completeMock).toHaveBeenCalledTimes(6);
    });
  });

  it('builds ContextPackage once in expansionNode (not 3x) when the item starts at expansion, with no Inception cache to reuse', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      const worldId = `forge-ctx-world2-${nanoid(6)}`;
      const articleId = `forge-ctx-article2-${nanoid(6)}`;
      const runId = `forge-ctx-run2-${nanoid(6)}`;
      await seedWorldAndArticleAndRun(worldId, articleId, runId);

      const worldContext = { worldId, name: 'Test World', tone: 'narrative', originPoint: null, styleConfig: null };

      completeMock
        .mockResolvedValueOnce(toolUseResult('submit_proposals', {
          proposals: [{ title: 'A Proposal', direction: 'Explore a bold new direction for this article.' }],
        }))
        .mockResolvedValueOnce(toolUseResult('submit_taste_selection', {
          selectedIndex: 0,
          rationale: 'Best fit for the article.',
        }))
        .mockResolvedValueOnce(toolUseResult('submit_research_brief', {
          keyFacts: ['Fact one about the article.'],
          suggestedAngles: ['An angle to explore.'],
        }))
        .mockResolvedValueOnce(textResult('A freshly generated description for the article, written by Scribe during this test run.'))
        .mockResolvedValueOnce(toolUseResult('submit_mentions', { mentions: [] }));

      const item = { articleId, title: 'Test Article', depth: 0, startStep: 'expansion' as const };
      const state = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext,
        currentItem: item,
        currentItemStepsDone: [],
        currentItemContextPackage: undefined,
      });

      const expansionResult = await expansionNode(state);
      expect(expansionResult.currentItemStepsDone).toContain('expansion');

      // No cache to reuse (Inception never ran this cascade), but Fix 3 still
      // means only ONE build for expansionNode's 2 sub-pipeline calls, not 2.
      expect(buildContextPackageCalls).toHaveBeenCalledTimes(1);
      expect(fetchWorldContextCalls).not.toHaveBeenCalled();
      expect(completeMock).toHaveBeenCalledTimes(5);
    });
  });
});

describe('forgeGraph expansion routing', () => {
  it('continues from accepted Manual/Assisted expansion to Branching for finish_document runs', () => {
    const route = routeAfterExpansion(baseForgeState({
      forgeContinuationMode: 'finish_document',
      autonomyMode: 'manual',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
      signal: 'continue',
      currentItemStepsDone: ['expansion'],
    }));

    expect(route).toBe('branching');
  });

  it('does not branch from an unreviewed pending draft', () => {
    const route = routeAfterExpansion(baseForgeState({
      forgeContinuationMode: 'finish_document',
      autonomyMode: 'auto_with_post_review',
      reviewPolicy: 'auto',
      commitPolicy: 'pending_draft',
      signal: 'continue',
      currentItemStepsDone: ['expansion'],
    }));

    expect(route).toBe('finishItem');
  });
});
