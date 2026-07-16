import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbClient } from '../db/client.js';
import { setupPostgresTestHarness, type PostgresTestHarness } from '../test/postgresHarness.js';
import { runWithUserContext } from '../requestContext.js';
import { buildContextPackage, getWorldInfoContext } from './archivist.js';

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

describe('archivist.getWorldInfoContext on Postgres', () => {
  it('returns the root article\'s title and introduction, not a non-root article\'s', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const worldId = 'archivist-world-info-world';

    await runWithUserContext(OWNER_ID, async () => {
      const exec = getDbClient();
      const now = Date.now();

      await exec.run(`
        INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
        VALUES (?, ?, 'World Info Test World', 'desc', '[]', 'narrative', '{}', ?, ?)
      `, [worldId, OWNER_ID, now, now]);

      const root = 'wi-root';
      const child = 'wi-child';

      await exec.run(`
        INSERT INTO articles (id, owner_id, world_id, title, status, template_type, depth, created_at, updated_at)
        VALUES (?, ?, ?, 'Root Article', 'published', 'general', 1, ?, ?),
               (?, ?, ?, 'Child Article', 'draft', 'general', 2, ?, ?)
      `, [
        root, OWNER_ID, worldId, now, now,
        child, OWNER_ID, worldId, now, now,
      ]);

      await exec.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'hierarchical')
      `, [root, child, OWNER_ID]);

      const rootVersion = 'wi-root-v1';
      const childVersion = 'wi-child-v1';
      await exec.run(`
        INSERT INTO article_versions (id, article_id, owner_id, version_number, introduction, created_at)
        VALUES (?, ?, ?, 1, 'Root introduction text.', ?),
               (?, ?, ?, 1, 'Child introduction text.', ?)
      `, [rootVersion, root, OWNER_ID, now, childVersion, child, OWNER_ID, now]);
      await exec.run(`UPDATE articles SET current_version_id = ? WHERE id = ?`, [rootVersion, root]);
      await exec.run(`UPDATE articles SET current_version_id = ? WHERE id = ?`, [childVersion, child]);
      await exec.run(`UPDATE worlds SET root_article_id = ? WHERE id = ?`, [root, worldId]);

      const worldInfo = await getWorldInfoContext(worldId, OWNER_ID);

      expect(worldInfo).toEqual({
        worldId,
        title: 'Root Article',
        introduction: 'Root introduction text.',
      });
    });
  });
});

describe('archivist.buildContextPackage hop-tier reach on Postgres', () => {
  it('gates tiers by contextDepth reach and field detail by hop distance, not a token budget', async ({ skip }) => {
    if (skipIfUnavailable(skip)) return;

    const worldId = 'archivist-hop-tier-world';

    await runWithUserContext(OWNER_ID, async () => {
      const exec = getDbClient();
      const now = Date.now();

      await exec.run(`
        INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
        VALUES (?, ?, 'Hop Tier Test World', 'desc', '[]', 'narrative', '{}', ?, ?)
      `, [worldId, OWNER_ID, now, now]);

      const target = 'hop-target';
      const parent = 'hop-parent';
      const child = 'hop-child';
      const sibling = 'hop-sibling';
      const fixedPoint = 'hop-fixed';
      const referenced = 'hop-referenced';

      await exec.run(`
        INSERT INTO articles (id, owner_id, world_id, title, status, template_type, is_fixed_point, depth, created_at, updated_at)
        VALUES (?, ?, ?, 'Target', 'draft', 'general', 0, 2, ?, ?),
               (?, ?, ?, 'Parent', 'published', 'general', 0, 1, ?, ?),
               (?, ?, ?, 'Child', 'draft', 'general', 0, 3, ?, ?),
               (?, ?, ?, 'Sibling', 'draft', 'general', 0, 2, ?, ?),
               (?, ?, ?, 'Fixed Point', 'published', 'general', 1, 1, ?, ?),
               (?, ?, ?, 'Referenced', 'published', 'general', 0, 1, ?, ?)
      `, [
        target, OWNER_ID, worldId, now, now,
        parent, OWNER_ID, worldId, now, now,
        child, OWNER_ID, worldId, now, now,
        sibling, OWNER_ID, worldId, now, now,
        fixedPoint, OWNER_ID, worldId, now, now,
        referenced, OWNER_ID, worldId, now, now,
      ]);

      await exec.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'hierarchical'),
               (?, ?, ?, 'hierarchical'),
               (?, ?, ?, 'hierarchical'),
               (?, ?, ?, 'references')
      `, [
        parent, target, OWNER_ID,
        target, child, OWNER_ID,
        parent, sibling, OWNER_ID,
        target, referenced, OWNER_ID,
      ]);

      const articleVersions: Array<[string, string, string, string]> = [
        [`${target}-v1`, target, 'Target introduction.', 'Target description.'],
        [`${parent}-v1`, parent, 'Parent introduction.', 'Parent description.'],
        [`${child}-v1`, child, 'Child introduction.', 'Child description.'],
        [`${sibling}-v1`, sibling, 'Sibling introduction.', 'Sibling description.'],
        [`${fixedPoint}-v1`, fixedPoint, 'Fixed point introduction.', 'Fixed point description.'],
        [`${referenced}-v1`, referenced, 'Referenced introduction.', 'Referenced description.'],
      ];
      for (const [versionId, articleRowId, introduction, description] of articleVersions) {
        await exec.run(`
          INSERT INTO article_versions (id, article_id, owner_id, version_number, introduction, description, created_at)
          VALUES (?, ?, ?, 1, ?, ?, ?)
        `, [versionId, articleRowId, OWNER_ID, introduction, description, now]);
        await exec.run(`UPDATE articles SET current_version_id = ? WHERE id = ?`, [versionId, articleRowId]);
      }

      // Shallow reach: closest tier only (mode: 'default', so children are
      // absent for the same reason they always have been — mode gating, not
      // reach). Held constant at mode: 'default' across all three depths
      // below so estimatedTokens comparisons isolate reach's effect alone.
      const shallow = await buildContextPackage(worldId, target, {
        mode: 'default',
        contextDepth: 'shallow',
        ownerId: OWNER_ID,
      });
      expect(shallow.parents).toEqual([
        expect.objectContaining({ id: parent, summary: 'Parent introduction.', description: 'Parent description.' }),
      ]);
      expect(shallow.children).toEqual([]);
      expect(shallow.siblings).toEqual([]);
      expect(shallow.fixedPoints).toEqual([]);
      expect(shallow.referencedArticles).toEqual([]);
      expect(shallow.estimatedTokens).toBeGreaterThan(0);

      // Children are also closest tier (1 hop, same as parents), so
      // propose_children mode surfaces them even at shallow reach — the fix
      // for the old code's unconditional shallow-mode skip. Checked as its
      // own call (mode varies here, so not part of the token comparison above).
      const shallowProposeChildren = await buildContextPackage(worldId, target, {
        mode: 'propose_children',
        contextDepth: 'shallow',
        ownerId: OWNER_ID,
      });
      expect(shallowProposeChildren.children).toEqual([
        expect.objectContaining({ id: child, summary: 'Child introduction.', description: 'Child description.' }),
      ]);

      // Mid reach: closest + medium. Siblings appear with introduction only
      // (never description, regardless of depth) — fixed points/referenced
      // articles (farthest tier) still don't show up at mid.
      const mid = await buildContextPackage(worldId, target, {
        mode: 'default',
        contextDepth: 'mid',
        ownerId: OWNER_ID,
      });
      expect(mid.parents).toEqual([
        expect.objectContaining({ id: parent, summary: 'Parent introduction.', description: 'Parent description.' }),
      ]);
      expect(mid.siblings).toEqual([
        expect.objectContaining({ id: sibling, summary: 'Sibling introduction.' }),
      ]);
      expect(mid.siblings[0]?.description).toBeUndefined();
      expect(mid.fixedPoints).toEqual([]);
      expect(mid.referencedArticles).toEqual([]);
      // Reach is additive, never a truncating ceiling: mid strictly includes
      // more content (and thus more estimated tokens) than shallow.
      expect(mid.estimatedTokens).toBeGreaterThan(shallow.estimatedTokens);

      // Deep reach: all three tiers. Farthest tier (fixed points, referenced
      // articles) is title-only — no introduction/summary text at all.
      const deep = await buildContextPackage(worldId, target, {
        mode: 'default',
        contextDepth: 'deep',
        ownerId: OWNER_ID,
      });
      expect(deep.parents).toEqual([
        expect.objectContaining({ id: parent, summary: 'Parent introduction.', description: 'Parent description.' }),
      ]);
      expect(deep.siblings).toEqual([
        expect.objectContaining({ id: sibling, summary: 'Sibling introduction.' }),
      ]);
      expect(deep.siblings[0]?.description).toBeUndefined();
      expect(deep.fixedPoints).toEqual([
        expect.objectContaining({ id: fixedPoint, title: 'Fixed Point', summary: '' }),
      ]);
      expect(deep.referencedArticles).toEqual([{ id: referenced, title: 'Referenced' }]);
      expect(deep.estimatedTokens).toBeGreaterThan(mid.estimatedTokens);
    });
  });
});
