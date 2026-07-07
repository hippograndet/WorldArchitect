import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

// ---------------------------------------------------------------------------
// SQLite (FTS5) — exercises the real production path: executeContextTool +
// reindexArticle/rebuildSearchIndexForWorld against an in-memory DB. Same
// mock pattern as context.test.ts.
// ---------------------------------------------------------------------------

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

// Import AFTER the mock is registered (vi.mock is hoisted, so this is safe).
import { executeContextTool } from './context.js';
import { reindexArticle, rebuildSearchIndexForWorld } from '../services/searchIndex.js';

function parseDataBlock(result: string): unknown {
  const match = result.match(/<untrusted_data[^>]*>\n([\s\S]*)\n<\/untrusted_data>/);
  return JSON.parse(match![1]);
}

function seedArticle(db: Database.Database, id: string, worldId: string, title: string, description: string): void {
  const now = Date.now();
  const versionId = `${id}-v1`;
  db.prepare(`INSERT INTO articles
      (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'published', 'general', ?, ?, ?)`)
    .run(id, worldId, `cat-${worldId}`, title, versionId, now, now);
  db.prepare(`INSERT INTO article_versions
      (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
     VALUES (?, ?, 1, ?, ?, '', 5, ?)`)
    .run(versionId, id, `Intro for ${title}.`, description, now);
}

function clearAll(db: Database.Database): void {
  db.exec(`
    DELETE FROM article_search_fts;
    DELETE FROM article_links;
    DELETE FROM article_versions;
    DELETE FROM articles;
    DELETE FROM categories;
    DELETE FROM worlds;
  `);
}

async function searchTitles(worldId: string, query: string): Promise<string[]> {
  const result = await executeContextTool(worldId, { id: 't', name: 'search_articles', input: { query } });
  const parsed = parseDataBlock(result) as Array<{ id: string; title: string }>;
  return parsed.map((r) => r.title);
}

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
  db.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES ('world1', 'TestWorld', 'desc', '[]', 'narrative', ?, ?)`).run(Date.now(), Date.now());
  db.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES ('cat-world1', 'world1', 'Misc', 0, ?)`).run(Date.now());
});

beforeEach(() => {
  clearAll(dbRef.db!);
  dbRef.db!.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES ('world1', 'TestWorld', 'desc', '[]', 'narrative', ?, ?)`).run(Date.now(), Date.now());
  dbRef.db!.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES ('cat-world1', 'world1', 'Misc', 0, ?)`).run(Date.now());
});

describe('search_articles (SQLite FTS5)', () => {
  it('finds an article by a word in its title after reindexArticle', async () => {
    seedArticle(dbRef.db!, 'dragon', 'world1', 'The Dragon King', 'A tale of fire.');
    await reindexArticle('world1', 'dragon');

    const titles = await searchTitles('world1', 'dragon');
    expect(titles).toContain('The Dragon King');
  });

  it('finds an article by a word in its description', async () => {
    seedArticle(dbRef.db!, 'treaty', 'world1', 'The Accord', 'Signed to end the long war.');
    await reindexArticle('world1', 'treaty');

    const titles = await searchTitles('world1', 'war');
    expect(titles).toContain('The Accord');
  });

  it('ranks a title match above a description-only match for the same term', async () => {
    seedArticle(dbRef.db!, 'a', 'world1', 'Phoenix', 'A creature reborn from ash.');
    seedArticle(dbRef.db!, 'b', 'world1', 'The Ash Fields', 'A phoenix was once seen here.');
    await reindexArticle('world1', 'a');
    await reindexArticle('world1', 'b');

    const titles = await searchTitles('world1', 'phoenix');
    expect(titles[0]).toBe('Phoenix');
  });

  it('does not surface a different world\'s articles', async () => {
    dbRef.db!.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
      VALUES ('world2', 'OtherWorld', 'desc', '[]', 'narrative', ?, ?)`).run(Date.now(), Date.now());
    dbRef.db!.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
      VALUES ('cat-world2', 'world2', 'Misc', 0, ?)`).run(Date.now());
    seedArticle(dbRef.db!, 'other', 'world2', 'The Griffin', 'Lives in world2.');
    await reindexArticle('world2', 'other');

    const titles = await searchTitles('world1', 'griffin');
    expect(titles).toEqual([]);
  });

  it('reindexing after an edit updates what is searchable', async () => {
    seedArticle(dbRef.db!, 'edited', 'world1', 'Old Title', 'original text');
    await reindexArticle('world1', 'edited');
    expect(await searchTitles('world1', 'original')).toContain('Old Title');

    dbRef.db!.prepare(`UPDATE article_versions SET description = ? WHERE article_id = ?`)
      .run('completely rewritten content', 'edited');
    await reindexArticle('world1', 'edited');

    expect(await searchTitles('world1', 'rewritten')).toContain('Old Title');
    expect(await searchTitles('world1', 'original')).toEqual([]);
  });

  it('deleting the article removes it from the search index (M19 trigger)', async () => {
    seedArticle(dbRef.db!, 'gone', 'world1', 'Doomed Article', 'will be deleted');
    await reindexArticle('world1', 'gone');
    expect(await searchTitles('world1', 'doomed')).toContain('Doomed Article');

    dbRef.db!.prepare('DELETE FROM articles WHERE id = ?').run('gone');

    const row = dbRef.db!.prepare('SELECT COUNT(*) AS n FROM article_search_fts WHERE article_id = ?').get('gone') as { n: number };
    expect(row.n).toBe(0);
  });

  it('rebuildSearchIndexForWorld repopulates from scratch (snapshot-restore path)', async () => {
    seedArticle(dbRef.db!, 'x', 'world1', 'Restored Kingdom', 'brought back from a snapshot');
    // No reindexArticle call — simulates the snapshot-restore route, which
    // writes articles via raw SQL and relies on rebuildSearchIndexForWorld
    // instead of the per-call-site hook.
    expect(await searchTitles('world1', 'restored')).toEqual([]);

    await rebuildSearchIndexForWorld('world1');

    expect(await searchTitles('world1', 'restored')).toContain('Restored Kingdom');
  });

  describe('adversarial query sanitization', () => {
    beforeEach(() => {
      seedArticle(dbRef.db!, 'safe', 'world1', 'A Perfectly Normal Article', 'nothing unusual here');
    });

    it('does not throw on an unbalanced quote', async () => {
      await expect(searchTitles('world1', 'dragon" OR 1=1')).resolves.toEqual([]);
    });

    it('does not throw on a leading dash (FTS5 NOT-operator syntax)', async () => {
      await expect(searchTitles('world1', '-keep')).resolves.toEqual([]);
    });

    it('does not throw and returns no results for a punctuation-only query', async () => {
      await expect(searchTitles('world1', '!!!---***')).resolves.toEqual([]);
    });

    it('does not throw on an empty query', async () => {
      await expect(searchTitles('world1', '')).resolves.toEqual([]);
    });

    it('still finds legitimate matches when other tests leave adversarial input aside', async () => {
      await reindexArticle('world1', 'safe');
      expect(await searchTitles('world1', 'normal')).toContain('A Perfectly Normal Article');
    });
  });
});
