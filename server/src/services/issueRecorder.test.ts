import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

import { getDbClient } from '../db/client.js';
import { recordArticleIssues, recordWorldIssues, recordProposedLinks } from './issueRecorder.js';

function seed(db: Database.Database) {
  const now = Date.now();
  db.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES ('world1', 'TestWorld', 'A test world', '[]', 'narrative', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES ('cat1', 'world1', 'History', 0, ?)`).run(now);

  const mkArticle = (id: string, title: string) => {
    db.prepare(`INSERT INTO articles (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
       VALUES (?, 'world1', 'cat1', ?, 'draft', 'general', NULL, ?, ?)`).run(id, title, now, now);
  };
  mkArticle('art1', 'Article One');
  mkArticle('art2', 'Article Two');
}

function clearAll(db: Database.Database) {
  db.exec(`
    DELETE FROM auditor_edge_proposals;
    DELETE FROM world_issues;
    DELETE FROM article_issues;
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

describe('recordArticleIssues', () => {
  it('replaces prior issues for the same (articleId, source) pair without touching other sources', async () => {
    const exec = getDbClient();

    await recordArticleIssues(exec, {
      worldId: 'world1', ownerId: 'owner1', articleId: 'art1', source: 'linter',
      issues: [{ severity: 'blocking', code: 'SEMANTIC_ISSUE', explanation: 'contradiction A' }],
    });
    await recordArticleIssues(exec, {
      worldId: 'world1', ownerId: 'owner1', articleId: 'art1', source: 'warden',
      issues: [{ severity: 'warning', code: 'COHERENCE_WARNING', explanation: 'minor tension' }],
    });

    // Re-run linter with a different issue set — should replace only the 'linter' rows
    await recordArticleIssues(exec, {
      worldId: 'world1', ownerId: 'owner1', articleId: 'art1', source: 'linter',
      issues: [{ severity: 'warning', code: 'SEMANTIC_ISSUE', explanation: 'contradiction B (revised)' }],
    });

    const rows = await exec.all<{ source: string; explanation: string }>(
      `SELECT source, explanation FROM article_issues WHERE article_id = 'art1' ORDER BY source`,
    );
    expect(rows).toEqual([
      { source: 'linter', explanation: 'contradiction B (revised)' },
      { source: 'warden', explanation: 'minor tension' },
    ]);
  });
});

describe('recordWorldIssues', () => {
  it('replaces open world_issues rows but preserves dismissed/resolved ones', async () => {
    const exec = getDbClient();

    await recordWorldIssues(exec, {
      worldId: 'world1', ownerId: 'owner1', source: 'auditor',
      warnings: [{ severity: 'warning', type: 'gap', description: 'stale gap', involvedArticleIds: ['art1'] }],
    });

    const [openRow] = await exec.all<{ id: string }>(`SELECT id FROM world_issues WHERE world_id = 'world1'`);
    await exec.run(`UPDATE world_issues SET status = 'dismissed' WHERE id = ?`, [openRow.id]);

    await recordWorldIssues(exec, {
      worldId: 'world1', ownerId: 'owner1', source: 'auditor',
      warnings: [{ severity: 'conflict', type: 'coherence', description: 'new conflict', involvedArticleIds: ['art2'] }],
    });

    const rows = await exec.all<{ status: string; description: string }>(
      `SELECT status, description FROM world_issues WHERE world_id = 'world1' ORDER BY description`,
    );
    expect(rows).toEqual([
      { status: 'open', description: 'new conflict' },
      { status: 'dismissed', description: 'stale gap' },
    ]);
  });
});

describe('recordProposedLinks', () => {
  it('skips proposals whose source or target article no longer exists', async () => {
    const exec = getDbClient();

    await recordProposedLinks(exec, {
      worldId: 'world1', ownerId: 'owner1',
      proposals: [
        { sourceArticleId: 'art1', targetArticleId: 'art2', linkType: 'references', rationale: 'valid' },
        { sourceArticleId: 'art1', targetArticleId: 'does-not-exist', linkType: 'references', rationale: 'stale' },
      ],
    });

    const rows = await exec.all<{ rationale: string }>(
      `SELECT rationale FROM auditor_edge_proposals WHERE world_id = 'world1'`,
    );
    expect(rows).toEqual([{ rationale: 'valid' }]);
  });
});
