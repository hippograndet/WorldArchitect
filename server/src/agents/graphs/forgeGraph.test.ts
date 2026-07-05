import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../../db/schema.js';

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock('../../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

// A real SqliteSaver would persist to the same on-disk DB file across process
// restarts; MemorySaver is enough here since these tests only need the
// checkpointer to round-trip state within one process, and never touch disk.
vi.mock('../checkpointer.js', () => ({
  getCheckpointer: async () => {
    const { MemorySaver } = await import('@langchain/langgraph');
    return new MemorySaver();
  },
}));

const pipelineMocks = vi.hoisted(() => ({
  runSummarizeGraph: vi.fn(),
  runProposeGraph: vi.fn(),
  runProposeIdeasGraph: vi.fn(),
  runExpandGraph: vi.fn(),
  runProposeChildrenGraph: vi.fn(),
  upsertEntry: vi.fn().mockResolvedValue(undefined),
  acceptDraft: vi.fn().mockResolvedValue({}),
  batchCreateChildArticles: vi.fn(),
}));
vi.mock('./pipelines/summarize.js', () => ({ runSummarizeGraph: pipelineMocks.runSummarizeGraph }));
vi.mock('./pipelines/propose.js', () => ({ runProposeGraph: pipelineMocks.runProposeGraph }));
vi.mock('./pipelines/proposeIdeas.js', () => ({ runProposeIdeasGraph: pipelineMocks.runProposeIdeasGraph }));
vi.mock('./pipelines/expand.js', () => ({ runExpandGraph: pipelineMocks.runExpandGraph }));
vi.mock('./pipelines/proposeChildren.js', () => ({ runProposeChildrenGraph: pipelineMocks.runProposeChildrenGraph }));
vi.mock('../../services/worldBible.js', () => ({ upsertEntry: pipelineMocks.upsertEntry }));
vi.mock('../../services/articlesService.js', () => ({
  acceptDraft: pipelineMocks.acceptDraft,
  batchCreateChildArticles: pipelineMocks.batchCreateChildArticles,
}));

const { startForgeRun, resumeForgeRun, getForgeGraph } = await import('./forgeGraph.js');
const { createRun, getRun, listRunEvents } = await import('../../services/runsService.js');

const WID = 'test-world';
const CAT_ID = 'test-cat';
const OWNER = 'local-user';

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
});

function reseed() {
  dbRef.db!.exec(`
    DELETE FROM run_events;
    DELETE FROM runs;
    DELETE FROM articles;
    DELETE FROM categories;
    DELETE FROM worlds;
  `);
  const now = Date.now();
  dbRef.db!.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES (?, 'TestWorld', 'desc', '[]', 'narrative', ?, ?)`).run(WID, now, now);
  dbRef.db!.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES (?, ?, 'Lore', 0, ?)`).run(CAT_ID, WID, now);
  dbRef.db!.prepare(`INSERT INTO articles (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
    VALUES ('root', ?, ?, 'Root Article', 'draft', 'general', NULL, ?, ?)`).run(WID, CAT_ID, now, now);
}

beforeEach(() => {
  reseed();
  vi.clearAllMocks();
  pipelineMocks.upsertEntry.mockResolvedValue(undefined);
  pipelineMocks.acceptDraft.mockResolvedValue({});
});

function successfulPipelineDefaults() {
  pipelineMocks.runSummarizeGraph.mockResolvedValue({ introduction: 'A polished intro.', tokensIn: 10, tokensOut: 5 });
  pipelineMocks.runProposeGraph.mockResolvedValue({
    proposals: [{ title: 'Direction A', direction: 'go this way' }],
    autoSelectedIndex: 0,
    tokensIn: 10,
    tokensOut: 5,
  });
  pipelineMocks.runExpandGraph.mockResolvedValue({ description: 'A long description.', tokensIn: 10, tokensOut: 5 });
  pipelineMocks.runProposeChildrenGraph.mockResolvedValue({
    proposals: [
      { title: 'Child One', introduction: 'intro one', templateType: 'general', nodeKind: 'instance', nodeKindRationale: 'r' },
    ],
    tokensIn: 10,
    tokensOut: 5,
  });
  // Real implementation (not a stub) — pending_drafts.article_id has a FK to
  // articles(id) with foreign_keys=ON in this test DB, so the child row must
  // actually exist for the child's own Expansion step to succeed.
  pipelineMocks.batchCreateChildArticles.mockImplementation(async ({ children }: { children: Array<{ title: string }> }) => {
    const now = Date.now();
    const created = children.map((c, i) => ({ id: `child-${i + 1}`, title: c.title }));
    for (const c of created) {
      dbRef.db!.prepare(`INSERT INTO articles (id, world_id, category_id, title, status, template_type, depth, current_version_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'stub', 'general', 1, NULL, ?, ?)`).run(c.id, WID, CAT_ID, c.title, now, now);
    }
    return { created };
  });
}

describe('startForgeRun', () => {
  it('runs the full Inception -> Expansion -> Branching cascade and completes', async () => {
    successfulPipelineDefaults();
    const run = await createRun({ worldId: WID, ownerId: OWNER, articleIds: ['root'] });

    await startForgeRun({
      runId: run.id,
      worldId: WID,
      ownerId: OWNER,
      articleId: 'root',
      articleTitle: 'Root Article',
      startStep: 'inception',
      contextDepth: 'mid',
      branchingMode: 'conceptual',
      forgeMode: 'breadth',
      forgeMaxDepth: 1,
      forgeMaxChildren: 5,
      forgeUseOracle: false,
      forgeUseContinuityEditor: false,
    });

    const finished = await getRun(WID, OWNER, run.id);
    expect(finished!.status).toBe('completed');
    expect(finished!.itemsCompleted).toBe(2); // root + 1 child
    expect(finished!.itemsTotal).toBe(2);

    const events = await listRunEvents(run.id);
    const steps = events.map((e) => `${e.step}:${e.ok}`).reverse();
    expect(steps).toEqual([
      'Inception:true', 'Expansion:true', 'Branching:true',
      'Inception:true', 'Expansion:true',
    ]);
    expect(pipelineMocks.batchCreateChildArticles).toHaveBeenCalledTimes(1);
  });

  it('a non-fatal error skips the rest of that item but continues the run', async () => {
    successfulPipelineDefaults();
    pipelineMocks.runExpandGraph.mockRejectedValueOnce(new Error('model returned malformed output'));
    const run = await createRun({ worldId: WID, ownerId: OWNER, articleIds: ['root'] });

    await startForgeRun({
      runId: run.id, worldId: WID, ownerId: OWNER, articleId: 'root', articleTitle: 'Root Article',
      startStep: 'inception', contextDepth: 'mid', branchingMode: 'conceptual', forgeMode: 'breadth',
      forgeMaxDepth: 1, forgeMaxChildren: 5, forgeUseOracle: false, forgeUseContinuityEditor: false,
    });

    const finished = await getRun(WID, OWNER, run.id);
    // Expansion failed non-fatally -> Branching for root never ran, no children queued.
    expect(finished!.status).toBe('completed');
    expect(finished!.itemsCompleted).toBe(1);
    expect(finished!.itemsTotal).toBe(1);
    expect(pipelineMocks.batchCreateChildArticles).not.toHaveBeenCalled();

    const events = await listRunEvents(run.id);
    expect(events.some((e) => e.step === 'Expansion' && !e.ok)).toBe(true);
  });

  it('a fatal (rate-limit) error stops the whole run as failed', async () => {
    successfulPipelineDefaults();
    pipelineMocks.runSummarizeGraph.mockRejectedValueOnce(new Error('429 Rate limit reached for model'));
    const run = await createRun({ worldId: WID, ownerId: OWNER, articleIds: ['root'] });

    await startForgeRun({
      runId: run.id, worldId: WID, ownerId: OWNER, articleId: 'root', articleTitle: 'Root Article',
      startStep: 'inception', contextDepth: 'mid', branchingMode: 'conceptual', forgeMode: 'breadth',
      forgeMaxDepth: 1, forgeMaxChildren: 5, forgeUseOracle: false, forgeUseContinuityEditor: false,
    });

    const finished = await getRun(WID, OWNER, run.id);
    expect(finished!.status).toBe('failed');
    expect(finished!.errorMessage).toMatch(/rate limit/i);
    // Locks are released on a failed run, same as a completed one.
    const article = dbRef.db!.prepare(`SELECT locked_by_run_id FROM articles WHERE id = 'root'`).get() as { locked_by_run_id: string | null };
    expect(article.locked_by_run_id).toBeNull();
  });
});

describe('resumeForgeRun', () => {
  it('continues a paused run from the remaining queue', async () => {
    successfulPipelineDefaults();
    const run = await createRun({ worldId: WID, ownerId: OWNER, articleIds: ['root'] });
    const { markRunStatus } = await import('../../services/runsService.js');

    // Simulate a pause request landing while the root item's Inception call
    // is in flight — pause only takes effect at dequeue's next boundary, so
    // root's own cascade (which creates one child via Branching) still runs
    // to completion; the child, still queued, is what proves the pause held.
    pipelineMocks.runSummarizeGraph.mockImplementationOnce(async () => {
      await markRunStatus(run.id, 'paused');
      return { introduction: 'A polished intro.', tokensIn: 10, tokensOut: 5 };
    });

    await startForgeRun({
      runId: run.id, worldId: WID, ownerId: OWNER, articleId: 'root', articleTitle: 'Root Article',
      startStep: 'inception', contextDepth: 'mid', branchingMode: 'conceptual', forgeMode: 'breadth',
      forgeMaxDepth: 1, forgeMaxChildren: 5, forgeUseOracle: false, forgeUseContinuityEditor: false,
    });

    const paused = await getRun(WID, OWNER, run.id);
    expect(paused!.status).toBe('paused');
    expect(paused!.itemsCompleted).toBe(1); // root finished; the child it created is still queued
    expect(paused!.itemsTotal).toBe(2);
    expect(pipelineMocks.runSummarizeGraph).toHaveBeenCalledTimes(1); // not yet called for the queued child

    await resumeForgeRun({ runId: run.id, worldId: WID });

    const finished = await getRun(WID, OWNER, run.id);
    expect(finished!.status).toBe('completed');
    expect(finished!.itemsCompleted).toBe(2);
    expect(pipelineMocks.runSummarizeGraph).toHaveBeenCalledTimes(2); // child's Inception ran after resume
  });

  it('a crash mid-cascade (currentItem set, steps partially done) resumes the same item instead of dropping it', async () => {
    successfulPipelineDefaults();
    // Depth 1 with maxDepth 1 -> branching is skipped for this item, keeping
    // the expected item count at exactly 1 (no children created to track).
    pipelineMocks.runProposeChildrenGraph.mockResolvedValue({ proposals: [], tokensIn: 0, tokensOut: 0 });
    pipelineMocks.batchCreateChildArticles.mockResolvedValue({ created: [] });

    const run = await createRun({ worldId: WID, ownerId: OWNER, articleIds: ['root'] });
    const graph = await getForgeGraph();
    const config = { configurable: { thread_id: run.id } };

    // Simulate exactly what a real crash-then-restart leaves behind: a
    // checkpoint where currentItem's Inception already succeeded but
    // Expansion/Branching never ran, and the queue is otherwise empty.
    await graph.invoke({
      worldId: WID,
      runId: run.id,
      ownerId: OWNER,
      contextDepth: 'mid',
      branchingMode: 'conceptual',
      forgeMode: 'breadth',
      forgeMaxDepth: 1,
      forgeMaxChildren: 5,
      forgeUseOracle: false,
      forgeUseContinuityEditor: false,
      currentItem: { articleId: 'root', title: 'Root Article', depth: 1, startStep: 'inception' },
      currentItemStepsDone: ['inception'],
      queue: [],
      total: 1,
      completed: 0,
      signal: 'paused', // parked, as if dequeue had just seen 'paused' right after this checkpoint
    }, config);
    await (await import('../../services/runsService.js')).markRunStatus(run.id, 'paused');

    await resumeForgeRun({ runId: run.id, worldId: WID });

    // Inception must NOT have been called again for the in-flight item.
    expect(pipelineMocks.runSummarizeGraph).not.toHaveBeenCalled();
    // Expansion must have run for it — this is the step that was interrupted.
    expect(pipelineMocks.runExpandGraph).toHaveBeenCalledTimes(1);

    const finished = await getRun(WID, OWNER, run.id);
    expect(finished!.status).toBe('completed');
    expect(finished!.itemsCompleted).toBe(1);
  });
});
