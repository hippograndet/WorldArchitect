import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import type { QueryExecutor } from '../db/executor.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { rebuildSearchIndexForWorld } from '../services/searchIndex.js';
import { requireTenantContext } from '../tenant.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Snapshot data shape captured at creation time
// ---------------------------------------------------------------------------

interface SnapshotArticleRow {
  id: string;
  world_id: string;
  owner_id: string;
  title: string;
  status: string;
  template_type: string;
  temporal_anchor_start: string | null;
  temporal_anchor_end: string | null;
  is_fixed_point: number;
  current_version_id: string | null;
  depth: number;
  created_at: number;
  updated_at: number;
}

interface SnapshotVersionRow {
  id: string;
  article_id: string;
  owner_id: string;
  version_number: number;
  introduction: string;
  description: string;
  chronology: string;
  expansion_params: string | null;
  proposal_used: string | null;
  word_count: number;
  is_revert: number;
  is_published: number;
  reverted_from_version_id: string | null;
  created_at: number;
}

interface SnapshotLinkRow {
  source_article_id: string;
  target_article_id: string;
  owner_id: string;
  link_type: string;
}

interface SnapshotBibleEntryRow {
  id: string;
  world_id: string;
  owner_id: string;
  article_id: string;
  summary: string;
  updated_at: number;
}

interface SnapshotBibleMetaRow {
  token_count: number;
  updated_at: number;
}

interface SnapshotWarningRow {
  id: string;
  article_id: string;
  owner_id: string;
  source_article_id: string | null;
  severity: string;
  description: string;
  status: string;
  created_at: number;
}

interface SnapshotData {
  articles: SnapshotArticleRow[];
  versions: SnapshotVersionRow[];
  links: SnapshotLinkRow[];
  bible_entries: SnapshotBibleEntryRow[];
  bible_meta: SnapshotBibleMetaRow | null;
  warnings: SnapshotWarningRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function captureSnapshot(exec: QueryExecutor, worldId: string, ownerId: string): Promise<SnapshotData> {
  const articles = await exec.all<SnapshotArticleRow>(
    `SELECT * FROM articles WHERE world_id = ? AND owner_id = ?`,
    [worldId, ownerId],
  );

  const articleIds = articles.map((a) => a.id);

  const versions = articleIds.length > 0
    ? await exec.all<SnapshotVersionRow>(
        `SELECT * FROM article_versions WHERE owner_id = ? AND article_id IN (${articleIds.map(() => '?').join(',')})`,
        [ownerId, ...articleIds],
      )
    : [];

  const links = articleIds.length > 0
    ? await exec.all<SnapshotLinkRow>(
        `SELECT * FROM article_links WHERE owner_id = ? AND source_article_id IN (${articleIds.map(() => '?').join(',')})`,
        [ownerId, ...articleIds],
      )
    : [];

  const bible_entries = await exec.all<SnapshotBibleEntryRow>(
    `SELECT * FROM world_bible_entries WHERE world_id = ? AND owner_id = ?`,
    [worldId, ownerId],
  );

  const bible_meta = (await exec.get<SnapshotBibleMetaRow>(
    `SELECT token_count, updated_at FROM world_bible_meta WHERE world_id = ? AND owner_id = ?`,
    [worldId, ownerId],
  )) ?? null;

  const warnings = articleIds.length > 0
    ? await exec.all<SnapshotWarningRow>(
        `SELECT * FROM coherence_warnings WHERE owner_id = ? AND article_id IN (${articleIds.map(() => '?').join(',')})`,
        [ownerId, ...articleIds],
      )
    : [];

  return { articles, versions, links, bible_entries, bible_meta, warnings };
}

async function persistSnapshot(
  exec: QueryExecutor,
  worldId: string,
  ownerId: string,
  name: string,
  data: SnapshotData,
): Promise<{ id: string; name: string; created_at: number }> {
  const id = nanoid();
  const now = Date.now();
  await exec.run(
    `INSERT INTO world_snapshots (id, world_id, owner_id, name, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, worldId, ownerId, name, JSON.stringify(data), now],
  );
  return { id, name, created_at: now };
}

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/snapshots
// ---------------------------------------------------------------------------

router.get('/', asyncHandler(async (req, res) => {
  const exec = getDbClient();
  const { worldId, ownerId } = requireTenantContext(req);

  const snapshots = await exec.all<{ id: string; name: string; created_at: number }>(
    `SELECT id, name, created_at FROM world_snapshots WHERE world_id = ? AND owner_id = ? ORDER BY created_at DESC`,
    [worldId, ownerId],
  );

  res.json(snapshots);
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/snapshots
// ---------------------------------------------------------------------------

const CreateSnapshotSchema = z.object({
  name: z.string().min(1).max(200),
});

router.post('/', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const exec = getDbClient();

  const parsed = CreateSnapshotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    return;
  }

  const data = await captureSnapshot(exec, worldId, ownerId);
  const snapshot = await persistSnapshot(exec, worldId, ownerId, parsed.data.name, data);
  res.status(201).json(snapshot);
}));

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/snapshots/:sid   — preview (article titles only)
// ---------------------------------------------------------------------------

router.get('/:sid', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const { sid } = req.params as Record<string, string>;
  const exec = getDbClient();

  const row = await exec.get<{ id: string; name: string; created_at: number; data: string }>(
    `SELECT id, name, created_at, data FROM world_snapshots WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [sid, worldId, ownerId],
  );

  if (!row) {
    res.status(404).json({ error: 'Snapshot not found.' });
    return;
  }

  const data = JSON.parse(row.data) as SnapshotData;

  const articlePreviews = data.articles.map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
  }));

  res.json({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    articleCount: data.articles.length,
    articles: articlePreviews,
  });
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/snapshots/:sid/restore
// ---------------------------------------------------------------------------

router.post('/:sid/restore', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const { sid } = req.params as Record<string, string>;
  const exec = getDbClient();

  const row = await exec.get<{ id: string; name: string; data: string }>(
    `SELECT id, name, data FROM world_snapshots WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [sid, worldId, ownerId],
  );

  if (!row) {
    res.status(404).json({ error: 'Snapshot not found.' });
    return;
  }

  // Auto-save current state before overwriting
  const currentData = await captureSnapshot(exec, worldId, ownerId);
  const autoSaveName = `Auto-save before restore ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`;
  const autoSave = await persistSnapshot(exec, worldId, ownerId, autoSaveName, currentData);

  const target = JSON.parse(row.data) as SnapshotData;

  await exec.transaction(async (tx) => {
    // Wipe current world content (CASCADE handles versions, links, warnings, bible_entries, pending_drafts)
    await tx.run(`DELETE FROM articles WHERE world_id = ? AND owner_id = ?`, [worldId, ownerId]);
    await tx.run(`DELETE FROM world_bible_entries WHERE world_id = ? AND owner_id = ?`, [worldId, ownerId]);

    // Restore articles
    for (const a of target.articles) {
      await tx.run(
        `INSERT INTO articles
           (id, world_id, owner_id, title, status, template_type,
            temporal_anchor_start, temporal_anchor_end, is_fixed_point,
            current_version_id, depth, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.id, worldId, ownerId, a.title, a.status, a.template_type,
          a.temporal_anchor_start, a.temporal_anchor_end, a.is_fixed_point,
          a.current_version_id, a.depth, a.created_at, a.updated_at,
        ],
      );
    }

    // Restore versions
    for (const v of target.versions) {
      await tx.run(
        `INSERT INTO article_versions
           (id, article_id, owner_id, version_number, introduction, description, chronology, expansion_params,
            proposal_used, word_count, is_revert, is_published, reverted_from_version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          v.id, v.article_id, ownerId, v.version_number, v.introduction, v.description, v.chronology, v.expansion_params,
          v.proposal_used, v.word_count, v.is_revert, v.is_published, v.reverted_from_version_id, v.created_at,
        ],
      );
    }

    // Restore links
    for (const l of target.links) {
      await tx.run(
        `INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (source_article_id, target_article_id) DO NOTHING`,
        [l.source_article_id, l.target_article_id, ownerId, l.link_type],
      );
    }

    // Restore bible entries
    for (const e of target.bible_entries) {
      await tx.run(
        `INSERT INTO world_bible_entries (id, world_id, owner_id, article_id, summary, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [e.id, worldId, ownerId, e.article_id, e.summary, e.updated_at],
      );
    }

    // Restore bible meta
    if (target.bible_meta) {
      await tx.run(
        `INSERT INTO world_bible_meta (world_id, owner_id, token_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(world_id) DO UPDATE SET token_count = excluded.token_count, updated_at = excluded.updated_at`,
        [worldId, ownerId, target.bible_meta.token_count, target.bible_meta.updated_at],
      );
    }

    // Restore coherence warnings
    for (const w of target.warnings) {
      await tx.run(
        `INSERT INTO coherence_warnings
           (id, article_id, owner_id, source_article_id, severity, description, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [w.id, w.article_id, ownerId, w.source_article_id, w.severity, w.description, w.status, w.created_at],
      );
    }
  });

  await rebuildSearchIndexForWorld(worldId, ownerId);

  res.json({ restored: row.name, autoSaved: autoSave });
}));

// ---------------------------------------------------------------------------
// DELETE /api/worlds/:wid/snapshots/:sid
// ---------------------------------------------------------------------------

router.delete('/:sid', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const { sid } = req.params as Record<string, string>;

  const result = await getDbClient().run(
    `DELETE FROM world_snapshots WHERE id = ? AND world_id = ? AND owner_id = ?`,
    [sid, worldId, ownerId],
  );

  if (result.changes === 0) {
    res.status(404).json({ error: 'Snapshot not found.' });
    return;
  }

  res.status(204).send();
}));

export default router;
