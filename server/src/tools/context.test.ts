import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

// ---------------------------------------------------------------------------
// In-memory DB wired up before any module that calls getDb() is loaded —
// same pattern as services/archivist.test.ts.
// ---------------------------------------------------------------------------

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

// Import the module AFTER the mock is registered
import { executeContextTool } from './context.js';

function seed(db: Database.Database) {
  const now = Date.now();

  const mkWorld = (id: string, name: string) => {
    db.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
      VALUES (?, ?, 'desc', '[]', 'narrative', ?, ?)`).run(id, name, now, now);
    db.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
      VALUES (?, ?, 'Misc', 0, ?)`).run(`cat-${id}`, id, now);
  };

  const mkArticle = (id: string, worldId: string, title: string) => {
    const versionId = `${id}-v1`;
    db.prepare(`INSERT INTO articles
        (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', 'general', ?, ?, ?)`)
      .run(id, worldId, `cat-${worldId}`, title, versionId, now, now);
    db.prepare(`INSERT INTO article_versions
        (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
       VALUES (?, ?, 1, '', ?, '', 5, ?)`)
      .run(versionId, id, `${title} description.`, now);
  };

  mkWorld('world1', 'TestWorld');
  mkWorld('world2', 'OtherWorld');

  mkArticle('target', 'world1', 'The Battle');
  mkArticle('linked-same-world', 'world1', 'The Treaty');
  mkArticle('linked-other-world', 'world2', 'Secret Of World2');

  // 'target' links out to one article in its own world and one in another world —
  // article_links has no DB constraint requiring both ends share a world_id.
  db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES (?, ?, 'references')`)
    .run('target', 'linked-same-world');
  db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES (?, ?, 'references')`)
    .run('target', 'linked-other-world');
  // And a reverse (incoming) link from the other-world article back to 'target'.
  db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES (?, ?, 'references')`)
    .run('linked-other-world', 'target');
}

function clearAll(db: Database.Database) {
  db.exec(`
    DELETE FROM article_links;
    DELETE FROM article_versions;
    DELETE FROM articles;
    DELETE FROM categories;
    DELETE FROM worlds;
  `);
}

function parseDataBlock(result: string): unknown {
  const match = result.match(/<untrusted_data[^>]*>\n([\s\S]*)\n<\/untrusted_data>/);
  return JSON.parse(match![1]);
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

describe('executeContextTool: get_article_links world scoping', () => {
  it('returns same-world outgoing links but not cross-world ones', async () => {
    const result = await executeContextTool('world1', { id: 't1', name: 'get_article_links', input: { articleId: 'target' } });
    const parsed = parseDataBlock(result) as { outgoing: Array<{ id: string }>; incoming: Array<{ id: string }> };

    expect(parsed.outgoing.some((r) => r.id === 'linked-same-world')).toBe(true);
    expect(parsed.outgoing.some((r) => r.id === 'linked-other-world')).toBe(false);
  });

  it('returns same-world incoming links but not cross-world ones', async () => {
    // Add a legitimate same-world incoming link too, for a same-vs-cross-world contrast.
    dbRef.db!.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES (?, ?, 'references')`)
      .run('linked-same-world', 'target');

    const result = await executeContextTool('world1', { id: 't2', name: 'get_article_links', input: { articleId: 'target' } });
    const parsed = parseDataBlock(result) as { outgoing: Array<{ id: string }>; incoming: Array<{ id: string }> };

    expect(parsed.incoming.some((r) => r.id === 'linked-same-world')).toBe(true);
    expect(parsed.incoming.some((r) => r.id === 'linked-other-world')).toBe(false);
  });

  it('returns empty outgoing/incoming for an articleId belonging to a different world', async () => {
    const result = await executeContextTool('world1', { id: 't3', name: 'get_article_links', input: { articleId: 'linked-other-world' } });
    const parsed = parseDataBlock(result) as { outgoing: Array<{ id: string }>; incoming: Array<{ id: string }> };

    expect(parsed.outgoing).toEqual([]);
    expect(parsed.incoming).toEqual([]);
  });
});

describe('executeContextTool: get_article world scoping (existing behavior, regression guard)', () => {
  it('returns not-found for an articleId belonging to a different world', async () => {
    const result = await executeContextTool('world1', { id: 't4', name: 'get_article', input: { articleId: 'linked-other-world' } });
    expect(JSON.parse(result)).toEqual({ error: 'Article not found' });
  });

  it('returns the article when it belongs to the requested world', async () => {
    const result = await executeContextTool('world1', { id: 't5', name: 'get_article', input: { articleId: 'target' } });
    const parsed = parseDataBlock(result) as { title: string };
    expect(parsed.title).toBe('The Battle');
  });
});
