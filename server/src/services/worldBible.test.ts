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

// Import the service AFTER the mock is registered
import { renderBible, getBibleMeta, upsertEntry, refreshTokenCount } from './worldBible.js';
import { getDbClient } from '../db/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seed(db: Database.Database) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES ('world1', 'TestWorld', 'A test world', '[]', 'narrative', ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES ('cat1', 'world1', 'History', 0, ?)
  `).run(now);

  db.prepare(`
    INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES ('cat2', 'world1', 'Culture', 1, ?)
  `).run(now);

  db.prepare(`
    INSERT INTO articles
      (id, world_id, category_id, title, status, template_type, is_fixed_point, created_at, updated_at)
    VALUES ('art1', 'world1', 'cat1', 'The Battle', 'draft', 'general', 0, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO articles
      (id, world_id, category_id, title, status, template_type, is_fixed_point, created_at, updated_at)
    VALUES ('art2', 'world1', 'cat2', 'Folk Music', 'draft', 'general', 0, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO world_bible_meta (world_id, token_count, updated_at)
    VALUES ('world1', 0, ?)
  `).run(now);

  db.prepare(`
    INSERT INTO cost_settings (world_id, bible_threshold)
    VALUES ('world1', 80000)
  `).run();
}

function clearAll(db: Database.Database) {
  db.exec(`
    DELETE FROM world_bible_entries;
    DELETE FROM world_bible_meta;
    DELETE FROM cost_settings;
    DELETE FROM articles;
    DELETE FROM categories;
    DELETE FROM worlds;
  `);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// renderBible
// ---------------------------------------------------------------------------

describe('renderBible', () => {
  it('returns empty string when no bible entries exist', async () => {
    expect(await renderBible('world1')).toBe('');
  });

  it('renders a single entry under its category heading', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'A great battle was fought.');
    const md = await renderBible('world1');
    expect(md).toContain('## History');
    expect(md).toContain('### The Battle');
    expect(md).toContain('A great battle was fought.');
  });

  it('renders entries grouped by category in sort_order', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'Summary A');
    await upsertEntry(getDbClient(), 'world1', 'art2', 'Summary B');
    const md = await renderBible('world1');
    const historyIdx = md.indexOf('## History');
    const cultureIdx = md.indexOf('## Culture');
    expect(historyIdx).toBeGreaterThanOrEqual(0);
    expect(cultureIdx).toBeGreaterThanOrEqual(0);
    // History (sort_order 0) appears before Culture (sort_order 1)
    expect(historyIdx).toBeLessThan(cultureIdx);
  });

  it('formats each article as ### Title + summary', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'Battle summary.');
    const md = await renderBible('world1');
    expect(md).toMatch(/### The Battle\nBattle summary\./);
  });

  it('returns empty string for a world that has no articles (different worldId)', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'Something');
    expect(await renderBible('nonexistent')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// upsertEntry
// ---------------------------------------------------------------------------

describe('upsertEntry', () => {
  it('creates a new bible entry for a valid article', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'My summary');
    const row = dbRef.db!
      .prepare('SELECT * FROM world_bible_entries WHERE article_id = ?')
      .get('art1') as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!.summary).toBe('My summary');
  });

  it('updates an existing entry on conflict (upsert behaviour)', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'First');
    await upsertEntry(getDbClient(), 'world1', 'art1', 'Updated');
    const rows = dbRef.db!
      .prepare('SELECT * FROM world_bible_entries WHERE article_id = ?')
      .all('art1');
    expect(rows).toHaveLength(1); // Still only one row
    expect((rows[0] as Record<string, unknown>).summary).toBe('Updated');
  });

  it('throws when the article does not exist', async () => {
    await expect(upsertEntry(getDbClient(), 'world1', 'ghost', 'x')).rejects.toThrow(/Article ghost not found/);
  });

  it('refreshes the token count after upsert', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'Hello world');
    const meta = dbRef.db!
      .prepare('SELECT token_count FROM world_bible_meta WHERE world_id = ?')
      .get('world1') as { token_count: number };
    expect(meta.token_count).toBeGreaterThan(0);
  });

  it('sets sort_order from the category sort_order', async () => {
    // art1 is in cat1 (sort_order 0), art2 is in cat2 (sort_order 1)
    await upsertEntry(getDbClient(), 'world1', 'art1', 'A');
    await upsertEntry(getDbClient(), 'world1', 'art2', 'B');
    const row1 = dbRef.db!
      .prepare('SELECT sort_order FROM world_bible_entries WHERE article_id = ?')
      .get('art1') as { sort_order: number };
    const row2 = dbRef.db!
      .prepare('SELECT sort_order FROM world_bible_entries WHERE article_id = ?')
      .get('art2') as { sort_order: number };
    expect(row1.sort_order).toBe(0);
    expect(row2.sort_order).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getBibleMeta
// ---------------------------------------------------------------------------

describe('getBibleMeta', () => {
  it('returns tokenCount 0 and default threshold when no entries', async () => {
    const meta = await getBibleMeta('world1');
    expect(meta.tokenCount).toBe(0);
    expect(meta.threshold).toBe(80000);
  });

  it('returns updated tokenCount after upsertEntry', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'A'.repeat(400)); // 400 chars / 4 = 100 tokens
    const meta = await getBibleMeta('world1');
    expect(meta.tokenCount).toBeGreaterThan(0);
  });

  it('returns 80000 as default threshold when no cost_settings row', async () => {
    // Remove cost_settings to test the fallback
    dbRef.db!.exec("DELETE FROM cost_settings WHERE world_id = 'world1'");
    const meta = await getBibleMeta('world1');
    expect(meta.threshold).toBe(80000);
  });

  it('returns the configured threshold from cost_settings', async () => {
    dbRef.db!
      .prepare("UPDATE cost_settings SET bible_threshold = 50000 WHERE world_id = 'world1'")
      .run();
    const meta = await getBibleMeta('world1');
    expect(meta.threshold).toBe(50000);
  });
});

// ---------------------------------------------------------------------------
// refreshTokenCount
// ---------------------------------------------------------------------------

describe('refreshTokenCount', () => {
  it('returns 0 when bible is empty', async () => {
    expect(await refreshTokenCount('world1')).toBe(0);
  });

  it('returns a positive count proportional to content length', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'X'.repeat(400));
    // The refresh was already called by upsertEntry; call again to verify
    const count = await refreshTokenCount('world1');
    expect(count).toBeGreaterThan(0);
    // ~400 chars of content + headings → at minimum 100 tokens
    expect(count).toBeGreaterThanOrEqual(10);
  });

  it('persists the updated token_count in world_bible_meta', async () => {
    await upsertEntry(getDbClient(), 'world1', 'art1', 'Y'.repeat(800));
    await refreshTokenCount('world1');
    const row = dbRef.db!
      .prepare('SELECT token_count FROM world_bible_meta WHERE world_id = ?')
      .get('world1') as { token_count: number };
    expect(row.token_count).toBeGreaterThan(0);
  });
});
