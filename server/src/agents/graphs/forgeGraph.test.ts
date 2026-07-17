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
const runForgeGraphCalls = vi.hoisted(() => vi.fn());

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

// Spies on runForgeGraph's params (specifically scribeMode, computed from
// forgeExpansionExistingMode — see forgeGraph/nodes.ts's expansionNode) while
// still exercising the real graph underneath.
vi.mock('./pipelines/forge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipelines/forge.js')>();
  return {
    ...actual,
    runForgeGraph: async (...args: Parameters<typeof actual.runForgeGraph>) => {
      runForgeGraphCalls(...args);
      return actual.runForgeGraph(...args);
    },
  };
});

// Import after the mocks above are registered.
import { dequeueNode, researchNode, inceptionNode, expansionNode } from './forgeGraph/nodes.js';
import { routeAfterExpansion } from './forgeGraph/routing.js';

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
  runForgeGraphCalls.mockClear();
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
  // This depth-1 article is the only one in the world, so it doubles as the
  // root article — needed for getWorldInfoContext (fetchWorldContextNode).
  await db.run(`UPDATE worlds SET root_article_id = ? WHERE id = ?`, [articleId, worldId]);
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
    worldInfoContext: undefined,
    contextDepth: 'mid',
    branchingMode: 'conceptual',
    forgeMode: 'breadth',
    forgeMaxDepth: 2,
    forgeMaxChildren: 0,
    coherenceCheckLevel: 0,
    safetyNet: false,
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
    currentItemResearchBrief: undefined,
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
  it('reuses one cached WorldContext + ContextPackage across researchNode, inceptionNode and expansionNode for one queue item', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      const worldId = `forge-ctx-world-${nanoid(6)}`;
      const articleId = `forge-ctx-article-${nanoid(6)}`;
      const runId = `forge-ctx-run-${nanoid(6)}`;
      await seedWorldAndArticleAndRun(worldId, articleId, runId);

      const worldContext = { worldId, name: 'Test World', tone: 'narrative', originPoint: null, styleConfig: null };
      const worldInfoContext = { worldId, title: 'Test Article', introduction: '' };

      completeMock
        .mockResolvedValueOnce(toolUseResult('submit_research_brief', {
          brief: 'Fact one about the article, established firmly in the surrounding world context and setting. An angle worth exploring further in future drafts.',
        }))
        .mockResolvedValueOnce(toolUseResult('submit_introduction', {
          introduction: 'A long and detailed introduction paragraph with plenty of descriptive words to pass the minimum word count check easily.',
        }))
        .mockResolvedValueOnce(toolUseResult('submit_ideas', {
          ideas: [
            { theme: 'A theme', detail: 'Explore a bold new direction for this article.' },
            { theme: 'Another theme', detail: 'A second angle to consider for this article.' },
            { theme: 'A third theme', detail: 'A third angle to consider for this article.' },
            { theme: 'A fourth theme', detail: 'A fourth angle to consider for this article.' },
            { theme: 'A fifth theme', detail: 'A fifth angle to consider for this article.' },
          ],
        }))
        .mockResolvedValueOnce(toolUseResult('submit_taste_selection', {
          selectedIndices: [0],
          rationale: 'Best fit for the article.',
        }))
        .mockResolvedValueOnce(textResult('A freshly generated description for the article, written by Scribe during this test run.'));

      const item = { articleId, title: 'Test Article', depth: 0, startStep: 'inception' as const };

      const dequeueResult = await dequeueNode(baseForgeState({ worldId, runId, ownerId: OWNER_ID, worldContext, queue: [item] }));
      expect(dequeueResult.signal).toBe('continue');

      const stateAfterDequeue = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext, worldInfoContext,
        currentItem: dequeueResult.currentItem,
        queue: dequeueResult.queue ?? [],
        currentItemStepsDone: dequeueResult.currentItemStepsDone ?? [],
      });

      const researchResult = await researchNode(stateAfterDequeue);
      expect(researchResult.currentItemResearchBrief).toBeDefined();
      expect(researchResult.currentItemContextPackage).toBeDefined();

      // researchNode built exactly one ContextPackage; worldContext was
      // already cached in state, so it was never re-fetched.
      expect(buildContextPackageCalls).toHaveBeenCalledTimes(1);
      expect(fetchWorldContextCalls).not.toHaveBeenCalled();

      const stateAfterResearch = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext, worldInfoContext,
        currentItem: stateAfterDequeue.currentItem,
        queue: stateAfterDequeue.queue,
        currentItemResearchBrief: researchResult.currentItemResearchBrief,
        currentItemContextPackage: researchResult.currentItemContextPackage,
      });

      const inceptionResult = await inceptionNode(stateAfterResearch);
      expect(inceptionResult.currentItemStepsDone).toContain('inception');
      expect(inceptionResult.currentItemContextPackage).toBeDefined();
      expect(inceptionResult.currentItemContextPackage?.targetIntroduction).toContain('long and detailed introduction');

      // Inception reuses researchNode's cached package (patched with the
      // fresh intro) instead of rebuilding — still exactly one build total.
      expect(buildContextPackageCalls).toHaveBeenCalledTimes(1);
      expect(fetchWorldContextCalls).not.toHaveBeenCalled();

      const stateAfterInception = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext, worldInfoContext,
        currentItem: stateAfterResearch.currentItem,
        queue: stateAfterResearch.queue,
        inceptionIntro: inceptionResult.inceptionIntro,
        currentItemContextPackage: inceptionResult.currentItemContextPackage,
        currentItemResearchBrief: stateAfterResearch.currentItemResearchBrief,
        currentItemStepsDone: inceptionResult.currentItemStepsDone ?? [],
      });

      const expansionResult = await expansionNode(stateAfterInception);
      expect(expansionResult.currentItemStepsDone).toContain('expansion');

      // expansionNode reuses the same cached package and research brief
      // across all of its internal sub-pipeline calls (Muse/Curator, Scribe)
      // instead of rebuilding or re-running Researcher — so the total build
      // count across all three nodes stays at 1, and Researcher's LLM call
      // only happened once (in researchNode), not again inside Expansion.
      expect(buildContextPackageCalls).toHaveBeenCalledTimes(1);
      expect(fetchWorldContextCalls).not.toHaveBeenCalled();
      expect(completeMock).toHaveBeenCalledTimes(5);

      // forgeExpansionExistingMode: 'improve' (baseForgeState's default)
      // translates into scribeMode: 'improve' on runForgeGraph's params —
      // the Task 1.4 plumbing fix, mirroring inceptionNode's summarizeMode.
      expect(runForgeGraphCalls).toHaveBeenCalledTimes(1);
      expect(runForgeGraphCalls.mock.calls[0]?.[0]).toMatchObject({ scribeMode: 'improve' });
    });
  });

  it('runs researchNode before expansionNode even when the item starts at expansion (Inception genuinely skipped), reusing its cached package and brief', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      const worldId = `forge-ctx-world2-${nanoid(6)}`;
      const articleId = `forge-ctx-article2-${nanoid(6)}`;
      const runId = `forge-ctx-run2-${nanoid(6)}`;
      await seedWorldAndArticleAndRun(worldId, articleId, runId);

      const worldContext = { worldId, name: 'Test World', tone: 'narrative', originPoint: null, styleConfig: null };
      const worldInfoContext = { worldId, title: 'Test Article', introduction: '' };

      completeMock
        .mockResolvedValueOnce(toolUseResult('submit_research_brief', {
          brief: 'Fact one about the article, established firmly in the surrounding world context and setting. An angle worth exploring further in future drafts.',
        }))
        .mockResolvedValueOnce(toolUseResult('submit_ideas', {
          ideas: [
            { theme: 'A theme', detail: 'Explore a bold new direction for this article.' },
            { theme: 'Another theme', detail: 'A second angle to consider for this article.' },
            { theme: 'A third theme', detail: 'A third angle to consider for this article.' },
            { theme: 'A fourth theme', detail: 'A fourth angle to consider for this article.' },
            { theme: 'A fifth theme', detail: 'A fifth angle to consider for this article.' },
          ],
        }))
        .mockResolvedValueOnce(toolUseResult('submit_taste_selection', {
          selectedIndices: [0],
          rationale: 'Best fit for the article.',
        }))
        .mockResolvedValueOnce(textResult('A freshly generated description for the article, written by Scribe during this test run.'));

      const item = { articleId, title: 'Test Article', depth: 0, startStep: 'expansion' as const };
      const state = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext, worldInfoContext,
        currentItem: item,
        currentItemStepsDone: [],
        currentItemContextPackage: undefined,
        currentItemResearchBrief: undefined,
      });

      const researchResult = await researchNode(state);
      expect(researchResult.currentItemResearchBrief).toBeDefined();
      expect(researchResult.currentItemContextPackage).toBeDefined();
      expect(buildContextPackageCalls).toHaveBeenCalledTimes(1);
      expect(fetchWorldContextCalls).not.toHaveBeenCalled();

      const stateAfterResearch = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext, worldInfoContext,
        currentItem: item,
        currentItemStepsDone: [],
        currentItemContextPackage: researchResult.currentItemContextPackage,
        currentItemResearchBrief: researchResult.currentItemResearchBrief,
      });

      // Inception is genuinely a no-op for a startStep:'expansion' item —
      // this is the exact scenario the explicit requirement targets:
      // Research must still have run before Expansion, even though Inception
      // never runs at all for this item.
      const inceptionResult = await inceptionNode(stateAfterResearch);
      expect(inceptionResult).toEqual({});

      const expansionResult = await expansionNode(stateAfterResearch);
      expect(expansionResult.currentItemStepsDone).toContain('expansion');

      // No additional build — expansionNode reuses researchNode's cached
      // package instead of rebuilding, and Researcher's own LLM call never
      // re-runs inside Expansion since state.researchBrief was already seeded.
      expect(buildContextPackageCalls).toHaveBeenCalledTimes(1);
      expect(fetchWorldContextCalls).not.toHaveBeenCalled();
      expect(completeMock).toHaveBeenCalledTimes(4);
    });
  });

  it('computes a distinctly different scribeMode for forgeExpansionExistingMode "replace" than "improve"', async ({ skip }) => {
    if (!harness) { skip(); return; }

    await runWithUserContext(OWNER_ID, async () => {
      const worldId = `forge-ctx-world3-${nanoid(6)}`;
      const articleId = `forge-ctx-article3-${nanoid(6)}`;
      const runId = `forge-ctx-run3-${nanoid(6)}`;
      await seedWorldAndArticleAndRun(worldId, articleId, runId);

      const worldContext = { worldId, name: 'Test World', tone: 'narrative', originPoint: null, styleConfig: null };
      const worldInfoContext = { worldId, title: 'Test Article', introduction: '' };

      completeMock
        .mockResolvedValueOnce(toolUseResult('submit_research_brief', {
          brief: 'Fact one about the article, established firmly in the surrounding world context and setting. An angle worth exploring further in future drafts.',
        }))
        .mockResolvedValueOnce(toolUseResult('submit_ideas', {
          ideas: [
            { theme: 'A theme', detail: 'Explore a bold new direction for this article.' },
            { theme: 'Another theme', detail: 'A second angle to consider for this article.' },
            { theme: 'A third theme', detail: 'A third angle to consider for this article.' },
            { theme: 'A fourth theme', detail: 'A fourth angle to consider for this article.' },
            { theme: 'A fifth theme', detail: 'A fifth angle to consider for this article.' },
          ],
        }))
        .mockResolvedValueOnce(toolUseResult('submit_taste_selection', {
          selectedIndices: [0],
          rationale: 'Best fit for the article.',
        }))
        .mockResolvedValueOnce(textResult('A freshly generated description for the article, written by Scribe during this test run.'));

      const item = { articleId, title: 'Test Article', depth: 0, startStep: 'expansion' as const };
      const state = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext, worldInfoContext,
        forgeExpansionExistingMode: 'replace',
        currentItem: item,
        currentItemStepsDone: [],
      });

      const researchResult = await researchNode(state);
      const stateAfterResearch = baseForgeState({
        worldId, runId, ownerId: OWNER_ID, worldContext, worldInfoContext,
        forgeExpansionExistingMode: 'replace',
        currentItem: item,
        currentItemStepsDone: [],
        currentItemContextPackage: researchResult.currentItemContextPackage,
        currentItemResearchBrief: researchResult.currentItemResearchBrief,
      });

      await expansionNode(stateAfterResearch);

      // 'replace' translates to scribeMode: 'full' — the same value 'create'/
      // 'skip_existing' would produce, and distinctly different from the
      // 'improve' case's scribeMode: 'improve' asserted in the test above.
      expect(runForgeGraphCalls).toHaveBeenCalledTimes(1);
      expect(runForgeGraphCalls.mock.calls[0]?.[0]).toMatchObject({ scribeMode: 'full' });
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
