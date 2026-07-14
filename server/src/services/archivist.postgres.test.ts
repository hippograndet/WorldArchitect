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

  it('treats an unpublished article as empty under contextBasis "published", never leaking its current draft', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const worldId = 'archivist-published-basis-world';

    await runWithUserContext(OWNER_ID, async () => {
      const exec = getDbClient();
      const now = Date.now();

      await exec.run(`
        INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
        VALUES (?, ?, 'Published Basis Test World', 'desc', '[]', 'narrative', '{}', ?, ?)
      `, [worldId, OWNER_ID, now, now]);

      const target = 'pb-target';
      const parentPublished = 'pb-parent-published';
      const parentUnpublished = 'pb-parent-unpublished';

      await exec.run(`
        INSERT INTO articles (id, owner_id, world_id, title, status, template_type, depth, created_at, updated_at)
        VALUES (?, ?, ?, 'Target', 'draft', 'general', 2, ?, ?),
               (?, ?, ?, 'Published Parent', 'published', 'general', 1, ?, ?),
               (?, ?, ?, 'Unpublished Parent', 'draft', 'general', 1, ?, ?)
      `, [
        target, OWNER_ID, worldId, now, now,
        parentPublished, OWNER_ID, worldId, now, now,
        parentUnpublished, OWNER_ID, worldId, now, now,
      ]);

      // Published parent: an old (unpublished) v1 and a published v2 — the
      // published-basis read must use v2's text, not v1's or any fallback.
      const publishedV1 = 'pb-parent-published-v1';
      const publishedV2 = 'pb-parent-published-v2';
      await exec.run(`
        INSERT INTO article_versions (id, article_id, owner_id, version_number, introduction, created_at)
        VALUES (?, ?, ?, 1, 'Stale unpublished draft text.', ?),
               (?, ?, ?, 2, 'Published intro text.', ?)
      `, [publishedV1, parentPublished, OWNER_ID, now, publishedV2, parentPublished, OWNER_ID, now]);
      await exec.run(
        `UPDATE articles SET current_version_id = ?, published_version_id = ? WHERE id = ?`,
        [publishedV2, publishedV2, parentPublished],
      );

      // Unpublished parent: has real current content, but no published_version_id.
      const unpublishedV1 = 'pb-parent-unpublished-v1';
      await exec.run(`
        INSERT INTO article_versions (id, article_id, owner_id, version_number, introduction, created_at)
        VALUES (?, ?, ?, 1, 'Draft-only text that must not leak under published basis.', ?)
      `, [unpublishedV1, parentUnpublished, OWNER_ID, now]);
      await exec.run(`UPDATE articles SET current_version_id = ? WHERE id = ?`, [unpublishedV1, parentUnpublished]);

      await exec.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'hierarchical'), (?, ?, ?, 'hierarchical')
      `, [parentPublished, target, OWNER_ID, parentUnpublished, target, OWNER_ID]);

      const contextPackage = await buildContextPackage(worldId, target, {
        mode: 'default',
        contextDepth: 'mid',
        ownerId: OWNER_ID,
        contextBasis: 'published',
      });

      const published = contextPackage.parents.find((p) => p.id === parentPublished);
      expect(published?.summary).toBe('Published intro text.');
      expect(published?.source?.versionId).toBe(publishedV2);

      const unpublished = contextPackage.parents.find((p) => p.id === parentUnpublished);
      expect(unpublished?.summary).toBe('');
      expect(unpublished?.source?.versionId).toBeNull();
    });
  });
});
