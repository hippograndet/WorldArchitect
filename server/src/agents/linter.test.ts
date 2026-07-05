import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

// ---------------------------------------------------------------------------
// In-memory DB wired up before any module that calls getDb() is loaded
// ---------------------------------------------------------------------------

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

// Import the agent AFTER the mock is registered
import { LinterAgent } from './linter.js';
import type { WorldContext } from './director.js';

const worldContext: WorldContext = {
  worldId: 'world1',
  name: 'TestWorld',
  tone: 'narrative',
  originPoint: null,
  styleConfig: null,
};

// ---------------------------------------------------------------------------
// Fixture: world1 > cat1 > { parent1 -> target, target -> sibling via parent1 },
// plus a fixed point unrelated to the hierarchy.
// ---------------------------------------------------------------------------

function seed(db: Database.Database) {
  const now = Date.now();
  db.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES ('world1', 'TestWorld', 'A test world', '[]', 'narrative', ?, ?)`).run(now, now);

  db.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES ('cat1', 'world1', 'History', 0, ?)`).run(now);

  const mkArticle = (id: string, title: string, isFixedPoint = 0) => {
    const versionId = `${id}-v1`;
    db.prepare(`INSERT INTO articles
        (id, world_id, category_id, title, status, template_type, is_fixed_point, current_version_id, created_at, updated_at)
       VALUES (?, 'world1', 'cat1', ?, 'draft', 'general', ?, ?, ?, ?)`)
      .run(id, title, isFixedPoint, versionId, now, now);
    db.prepare(`INSERT INTO article_versions
        (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
       VALUES (?, ?, 1, '', ?, '', 10, ?)`)
      .run(versionId, id, `${title} description body.`, now);
  };

  mkArticle('parent1', 'The Old Kingdom');
  mkArticle('target', 'The Battle');
  mkArticle('sibling1', 'The Treaty');
  mkArticle('fixed1', 'The Sun', 1);

  const bibleEntry = (articleId: string, summary: string) => {
    db.prepare(`INSERT INTO world_bible_entries (id, world_id, article_id, summary, updated_at)
      VALUES (?, 'world1', ?, ?, ?)`).run(`wbe-${articleId}`, articleId, summary, now);
  };
  bibleEntry('parent1', 'A once-great kingdom, now in ruins.');
  bibleEntry('target', 'A decisive battle.');
  bibleEntry('sibling1', 'A treaty signed after the war.');
  bibleEntry('fixed1', 'The sun never sets on this world.');

  // parent1 -> target (hierarchical), parent1 -> sibling1 (hierarchical, makes sibling1 a true sibling of target)
  db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES (?, ?, 'hierarchical')`)
    .run('parent1', 'target');
  db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES (?, ?, 'hierarchical')`)
    .run('parent1', 'sibling1');
}

function clearAll(db: Database.Database) {
  db.exec(`
    DELETE FROM article_links;
    DELETE FROM world_bible_entries;
    DELETE FROM article_versions;
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

describe('LinterAgent.buildMessages', () => {
  it('builds a prompt from the real schema without referencing the removed av.body column', async () => {
    const agent = new LinterAgent() as unknown as {
      buildMessages(worldId: string, input: { worldId: string; articleId: string; worldContext: WorldContext }): Promise<Array<{ role: string; content: string }>>;
    };

    // Prior to the fix, this threw "no such column: av.body" against the current schema
    // (article_versions was migrated to introduction/description/chronology in M14).
    const messages = await agent.buildMessages('world1', {
      worldId: 'world1',
      articleId: 'target',
      worldContext,
    });

    const userMessage = messages.find((m) => m.role === 'user')!.content;
    expect(userMessage).toContain('The Battle description body.');
    expect(userMessage).toContain('The Old Kingdom'); // parent
    expect(userMessage).toContain('The Treaty');       // sibling (via shared parent1)
    expect(userMessage).toContain('The Sun');          // fixed point
  });

  it('falls back gracefully for a non-existent article instead of throwing', async () => {
    const agent = new LinterAgent() as unknown as {
      buildMessages(worldId: string, input: { worldId: string; articleId: string; worldContext: WorldContext }): Promise<Array<{ role: string; content: string }>>;
    };

    const messages = await agent.buildMessages('world1', {
      worldId: 'world1',
      articleId: 'does-not-exist',
      worldContext,
    });

    expect(messages.find((m) => m.role === 'user')!.content).toBe('Article not found.');
  });
});
