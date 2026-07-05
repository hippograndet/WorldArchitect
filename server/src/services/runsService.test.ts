import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

import { getDbClient } from '../db/client.js';
import {
  createRun,
  getRun,
  listRuns,
  cancelRun,
  markRunStatus,
  bumpRunBudget,
  releaseLocks,
  assertArticleUnlocked,
  RunConflictError,
} from './runsService.js';

const WORLD_ID = 'world1';
const OWNER_ID = 'owner1';

function seed(db: Database.Database) {
  const now = Date.now();
  db.prepare(`INSERT INTO worlds (id, owner_id, name, description, tags, tone, created_at, updated_at)
    VALUES (?, ?, 'TestWorld', 'A test world', '[]', 'narrative', ?, ?)`).run(WORLD_ID, OWNER_ID, now, now);
  db.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES ('cat1', ?, 'History', 0, ?)`).run(WORLD_ID, now);

  const mkArticle = (id: string) => {
    db.prepare(`INSERT INTO articles (id, world_id, owner_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
       VALUES (?, ?, ?, 'cat1', ?, 'draft', 'general', NULL, ?, ?)`).run(id, WORLD_ID, OWNER_ID, id, now, now);
  };
  mkArticle('art1');
  mkArticle('art2');
}

function clearAll(db: Database.Database) {
  db.exec(`
    DELETE FROM runs;
    DELETE FROM articles;
    DELETE FROM categories;
    DELETE FROM worlds;
  `);
}

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
});

beforeEach(() => {
  clearAll(dbRef.db!);
  seed(dbRef.db!);
});

describe('createRun', () => {
  it('creates a run and locks all target articles', async () => {
    const run = await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1', 'art2'] });
    expect(run.status).toBe('pending');
    expect(run.articleIds).toEqual(['art1', 'art2']);

    const rows = await getDbClient().all<{ id: string; locked_by_run_id: string }>(
      `SELECT id, locked_by_run_id FROM articles WHERE world_id = ? ORDER BY id`, [WORLD_ID],
    );
    expect(rows.every((r) => r.locked_by_run_id === run.id)).toBe(true);
  });

  it('rejects creating a run when a target article is already locked by another run', async () => {
    await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1'] });

    await expect(
      createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1', 'art2'] }),
    ).rejects.toThrow(RunConflictError);

    // Second createRun must not have partially locked art2 despite failing on art1
    const art2 = await getDbClient().get<{ locked_by_run_id: string | null }>(
      `SELECT locked_by_run_id FROM articles WHERE id = 'art2'`,
    );
    expect(art2?.locked_by_run_id).toBeNull();
  });
});

describe('getRun / listRuns', () => {
  it('lists runs newest first and scopes by owner', async () => {
    const run1 = await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1'] });
    await new Promise((r) => setTimeout(r, 2));
    const run2 = await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art2'] });

    const runs = await listRuns(WORLD_ID, OWNER_ID);
    expect(runs.map((r) => r.id)).toEqual([run2.id, run1.id]);

    const otherOwner = await listRuns(WORLD_ID, 'someone-else');
    expect(otherOwner).toEqual([]);
  });

  it('returns null for a run belonging to a different owner', async () => {
    const run = await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1'] });
    expect(await getRun(WORLD_ID, 'someone-else', run.id)).toBeNull();
  });
});

describe('markRunStatus / bumpRunBudget', () => {
  it('updates status and error message', async () => {
    const run = await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1'] });
    await markRunStatus(run.id, 'failed', 'Recursion limit reached.');
    const updated = await getRun(WORLD_ID, OWNER_ID, run.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.errorMessage).toBe('Recursion limit reached.');
  });

  it('accumulates budget across multiple calls', async () => {
    const run = await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1'] });
    await bumpRunBudget(run.id, 100);
    await bumpRunBudget(run.id, 50);
    const updated = await getRun(WORLD_ID, OWNER_ID, run.id);
    expect(updated?.budgetUsed).toBe(150);
  });
});

describe('releaseLocks / cancelRun', () => {
  it('clears locked_by_run_id on all articles for that run only', async () => {
    const run1 = await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1'] });
    await releaseLocks(WORLD_ID, run1.id);
    const art1 = await getDbClient().get<{ locked_by_run_id: string | null }>(`SELECT locked_by_run_id FROM articles WHERE id = 'art1'`);
    expect(art1?.locked_by_run_id).toBeNull();
  });

  it('cancelRun marks the run stopped and releases its locks', async () => {
    const run = await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1', 'art2'] });
    const cancelled = await cancelRun(WORLD_ID, OWNER_ID, run.id);
    expect(cancelled?.status).toBe('stopped');

    const rows = await getDbClient().all<{ locked_by_run_id: string | null }>(`SELECT locked_by_run_id FROM articles WHERE world_id = ?`, [WORLD_ID]);
    expect(rows.every((r) => r.locked_by_run_id === null)).toBe(true);
  });
});

describe('assertArticleUnlocked', () => {
  it('resolves when the article has no active lock', async () => {
    await expect(assertArticleUnlocked(WORLD_ID, 'art1')).resolves.toBeUndefined();
  });

  it('throws a 409 AppError when the article is locked', async () => {
    await createRun({ worldId: WORLD_ID, ownerId: OWNER_ID, articleIds: ['art1'] });
    await expect(assertArticleUnlocked(WORLD_ID, 'art1')).rejects.toMatchObject({ statusCode: 409, code: 'ARTICLE_LOCKED' });
  });
});
