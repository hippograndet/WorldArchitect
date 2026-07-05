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
import { buildContextPackage } from './archivist.js';

// ---------------------------------------------------------------------------
// Fixture: a published target article with a reviewed parent, a draft child,
// a draft sibling (via the same parent), and a stub fixed point.
// ---------------------------------------------------------------------------

function seed(db: Database.Database) {
  const now = Date.now();
  db.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES ('world1', 'TestWorld', 'A test world', '[]', 'narrative', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES ('cat1', 'world1', 'History', 0, ?)`).run(now);

  const mkArticle = (id: string, title: string, status: string, templateType: string, isFixedPoint = 0) => {
    const versionId = `${id}-v1`;
    db.prepare(`INSERT INTO articles
        (id, world_id, category_id, title, status, template_type, is_fixed_point, current_version_id, created_at, updated_at)
       VALUES (?, 'world1', 'cat1', ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, title, status, templateType, isFixedPoint, versionId, now, now);
    db.prepare(`INSERT INTO article_versions
        (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
       VALUES (?, ?, 1, '', ?, '', 10, ?)`)
      .run(versionId, id, `${title} description.`, now);
  };

  mkArticle('parent1', 'The Old Kingdom', 'reviewed', 'location');
  mkArticle('target', 'The Battle', 'published', 'historical_event');
  mkArticle('sibling1', 'The Treaty', 'draft', 'general');
  mkArticle('child1', 'The Aftermath', 'draft', 'general');
  mkArticle('fixed1', 'The Sun', 'stub', 'concept', 1);

  const bibleEntry = (articleId: string, summary: string) => {
    db.prepare(`INSERT INTO world_bible_entries (id, world_id, article_id, summary, updated_at)
      VALUES (?, 'world1', ?, ?, ?)`).run(`wbe-${articleId}`, articleId, summary, now);
  };
  bibleEntry('parent1', 'A once-great kingdom.');
  bibleEntry('target', 'A decisive battle.');
  bibleEntry('sibling1', 'A treaty signed after the war.');
  bibleEntry('child1', 'What happened after.');
  bibleEntry('fixed1', 'The sun never sets here.');

  db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES (?, ?, 'hierarchical')`)
    .run('parent1', 'target');
  db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES (?, ?, 'hierarchical')`)
    .run('parent1', 'sibling1');
  db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES (?, ?, 'hierarchical')`)
    .run('target', 'child1');
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

describe('buildContextPackage source-awareness', () => {
  it('maps target status/template_type to contextMode/subjectType/versionId', async () => {
    const pkg = await buildContextPackage('world1', 'target', { contextDepth: 'mid' });

    expect(pkg.targetVersionId).toBe('target-v1');
    expect(pkg.contextMode).toBe('published');
    expect(pkg.targetSubjectType).toBe('event'); // historical_event -> event
  });

  it('tags each context article with a source carrying authority derived from its own status', async () => {
    const pkg = await buildContextPackage('world1', 'target', { contextDepth: 'mid', mode: 'propose_children' });

    const parent = pkg.parents.find((p) => p.id === 'parent1')!;
    expect(parent.source).toEqual({
      articleId: 'parent1',
      versionId: 'parent1-v1',
      contextMode: 'reviewed',
      authority: 'reviewed',
    });

    const sibling = pkg.siblings.find((s) => s.id === 'sibling1')!;
    expect(sibling.source?.authority).toBe('draft');

    const child = pkg.children.find((c) => c.id === 'child1')!;
    expect(child.source?.authority).toBe('draft');

    const fixed = pkg.fixedPoints.find((f) => f.id === 'fixed1')!;
    expect(fixed.source?.authority).toBe('draft'); // stub maps to 'draft' (no better fit)
  });

  it('derives dependencies from real article_links rows for parents/children, not for siblings/fixed points', async () => {
    const pkg = await buildContextPackage('world1', 'target', { contextDepth: 'mid', mode: 'propose_children' });

    expect(pkg.dependencies).toContainEqual({
      sourceArticleId: 'parent1',
      sourceVersionId: 'parent1-v1',
      targetArticleId: 'target',
      targetVersionId: 'target-v1',
      dependencyType: 'hierarchy',
    });
    expect(pkg.dependencies).toContainEqual({
      sourceArticleId: 'target',
      sourceVersionId: 'target-v1',
      targetArticleId: 'child1',
      targetVersionId: 'child1-v1',
      dependencyType: 'hierarchy',
    });

    // Siblings/fixed points have no direct article_links edge to the target itself —
    // they must not be fabricated into the dependency graph.
    const sourceIds = pkg.dependencies!.map((d) => `${d.sourceArticleId}->${d.targetArticleId}`);
    expect(sourceIds).not.toContain('sibling1->target');
    expect(sourceIds).not.toContain('target->sibling1');
    expect(sourceIds).not.toContain('fixed1->target');
  });

  it('leaves metadataFacts unset — no backing table exists yet', async () => {
    const pkg = await buildContextPackage('world1', 'target', { contextDepth: 'mid' });
    expect(pkg.metadataFacts).toBeUndefined();
  });
});

describe('buildContextPackage world isolation', () => {
  /**
   * article_links has no DB constraint tying target_article_id to the same world
   * as its source (only an owner-backfill trigger) — these rows simulate that gap
   * to prove buildContextPackage's tiers don't trust the link alone.
   */
  function seedOtherWorldAndCrossLinks(db: Database.Database) {
    const now = Date.now();
    db.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
      VALUES ('world2', 'OtherWorld', 'A different tenant world', '[]', 'narrative', ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
      VALUES ('cat2', 'world2', 'Misc', 0, ?)`).run(now);
    const mkIntruder = (id: string) => {
      db.prepare(`INSERT INTO articles
          (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
         VALUES (?, 'world2', 'cat2', 'Secret Of World2', 'published', 'general', ?, ?, ?)`)
        .run(id, `${id}-v1`, now, now);
      db.prepare(`INSERT INTO article_versions
          (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
         VALUES (?, ?, 1, '', 'World2 secret description.', '', 5, ?)`).run(`${id}-v1`, id, now);
      db.prepare(`INSERT INTO world_bible_entries (id, world_id, article_id, summary, updated_at)
        VALUES (?, 'world2', ?, 'A secret from another world.', ?)`).run(`wbe-${id}`, id, now);
    };
    // article_links' PK is (source_article_id, target_article_id) regardless of
    // link_type, so distinct (source, target) pairs are needed per link tested —
    // one intruder article per tier being probed.
    mkIntruder('intruder-parent');
    mkIntruder('intruder-child');
    mkIntruder('intruder-sibling');
    mkIntruder('intruder-ref');

    db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES ('intruder-parent', 'target', 'hierarchical')`).run();
    db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES ('target', 'intruder-child', 'hierarchical')`).run();
    db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES ('parent1', 'intruder-sibling', 'hierarchical')`).run();
    db.prepare(`INSERT INTO article_links (source_article_id, target_article_id, link_type) VALUES ('target', 'intruder-ref', 'references')`).run();
  }

  it('never surfaces an out-of-world article via parents, children, siblings, or referencedArticles', async () => {
    seedOtherWorldAndCrossLinks(dbRef.db!);

    const pkg = await buildContextPackage('world1', 'target', { contextDepth: 'deep', mode: 'propose_children' });

    expect(pkg.parents.some((p) => p.id === 'intruder-parent')).toBe(false);
    expect(pkg.children.some((c) => c.id === 'intruder-child')).toBe(false);
    expect(pkg.siblings.some((s) => s.id === 'intruder-sibling')).toBe(false);
    expect(pkg.referencedArticles.some((r) => r.id === 'intruder-ref')).toBe(false);

    // The legitimate same-world parent/sibling must still come through unaffected.
    expect(pkg.parents.some((p) => p.id === 'parent1')).toBe(true);
    expect(pkg.siblings.some((s) => s.id === 'sibling1')).toBe(true);
  });
});
