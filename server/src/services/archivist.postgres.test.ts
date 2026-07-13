import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbClient } from '../db/client.js';
import { setupPostgresTestHarness, type PostgresTestHarness } from '../test/postgresHarness.js';
import { runWithUserContext } from '../requestContext.js';
import { buildContextPackage } from './archivist.js';

const WORLD_ID = 'archivist-pg-world';
const OWNER_ID = 'archivist-owner';

let harness: PostgresTestHarness | null = null;

beforeAll(async () => {
  harness = await setupPostgresTestHarness('archivist');
});

afterAll(async () => {
  await harness?.cleanup();
});

function skipIfUnavailable(skip: () => void): boolean {
  if (harness) return false;
  skip();
  return true;
}

describe('archivist.buildContextPackage on Postgres', () => {
  it('does not error when a sibling shares more than one parent with the target', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    // Reproduces the run-time crash this test guards against: a target
    // article with two parents (parentA, parentB), where a sibling article
    // is *also* a child of both parents. The siblings query's
    // `source_article_id IN (parentA, parentB)` join then matches the
    // sibling twice before DISTINCT collapses it — exactly the shape that
    // triggered Postgres's "for SELECT DISTINCT, ORDER BY expressions must
    // appear in select list" error.
    await runWithUserContext(OWNER_ID, async () => {
      const exec = getDbClient();
      const now = Date.now();

      await exec.run(`
        INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
        VALUES (?, ?, 'Archivist Test World', 'desc', '[]', 'narrative', '{}', ?, ?)
      `, [WORLD_ID, OWNER_ID, now, now]);

      const parentA = 'parent-a';
      const parentB = 'parent-b';
      const target = 'target';
      const sibling = 'sibling';

      await exec.run(`
        INSERT INTO articles (id, owner_id, world_id, title, status, template_type, depth, created_at, updated_at)
        VALUES (?, ?, ?, 'Parent A', 'published', 'general', 1, ?, ?),
               (?, ?, ?, 'Parent B', 'published', 'general', 1, ?, ?),
               (?, ?, ?, 'Target', 'draft', 'general', 2, ?, ?),
               (?, ?, ?, 'Sibling', 'draft', 'general', 2, ?, ?)
      `, [
        parentA, OWNER_ID, WORLD_ID, now, now,
        parentB, OWNER_ID, WORLD_ID, now, now,
        target, OWNER_ID, WORLD_ID, now, now,
        sibling, OWNER_ID, WORLD_ID, now, now,
      ]);

      await exec.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'hierarchical'),
               (?, ?, ?, 'hierarchical'),
               (?, ?, ?, 'hierarchical'),
               (?, ?, ?, 'hierarchical')
      `, [
        parentA, target, OWNER_ID,
        parentB, target, OWNER_ID,
        parentA, sibling, OWNER_ID,
        parentB, sibling, OWNER_ID,
      ]);

      const contextPackage = await buildContextPackage(WORLD_ID, target, {
        mode: 'default',
        contextDepth: 'mid',
        ownerId: OWNER_ID,
      });

      expect(contextPackage.parents.map((p) => p.id).sort()).toEqual([parentA, parentB]);
      // The sibling must be deduplicated to a single entry despite matching
      // through both parent links.
      expect(contextPackage.siblings.filter((s) => s.id === sibling)).toHaveLength(1);
    });
  });
});
