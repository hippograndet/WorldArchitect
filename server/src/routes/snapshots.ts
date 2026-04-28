import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb } from '../db/index.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Snapshot data shape captured at creation time
// ---------------------------------------------------------------------------

interface SnapshotArticleRow {
  id: string;
  world_id: string;
  category_id: string;
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
  version_number: number;
  body: string;
  summary: string;
  expansion_params: string | null;
  proposal_used: string | null;
  word_count: number;
  is_revert: number;
  reverted_from_version_id: string | null;
  created_at: number;
}

interface SnapshotLinkRow {
  source_article_id: string;
  target_article_id: string;
  link_type: string;
}

interface SnapshotBibleEntryRow {
  id: string;
  world_id: string;
  article_id: string;
  summary: string;
  sort_order: number;
  updated_at: number;
}

interface SnapshotBibleMetaRow {
  token_count: number;
  updated_at: number;
}

interface SnapshotWarningRow {
  id: string;
  article_id: string;
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

function captureSnapshot(worldId: string): SnapshotData {
  const db = getDb();

  const articles = db
    .prepare(`SELECT * FROM articles WHERE world_id = ?`)
    .all(worldId) as SnapshotArticleRow[];

  const articleIds = articles.map((a) => a.id);

  const versions =
    articleIds.length > 0
      ? (db
          .prepare(
            `SELECT * FROM article_versions WHERE article_id IN (${articleIds.map(() => '?').join(',')})`,
          )
          .all(...articleIds) as SnapshotVersionRow[])
      : [];

  const links =
    articleIds.length > 0
      ? (db
          .prepare(
            `SELECT * FROM article_links WHERE source_article_id IN (${articleIds.map(() => '?').join(',')})`,
          )
          .all(...articleIds) as SnapshotLinkRow[])
      : [];

  const bible_entries = db
    .prepare(`SELECT * FROM world_bible_entries WHERE world_id = ?`)
    .all(worldId) as SnapshotBibleEntryRow[];

  const bible_meta =
    (db
      .prepare(`SELECT token_count, updated_at FROM world_bible_meta WHERE world_id = ?`)
      .get(worldId) as SnapshotBibleMetaRow | undefined) ?? null;

  const warnings =
    articleIds.length > 0
      ? (db
          .prepare(
            `SELECT * FROM coherence_warnings WHERE article_id IN (${articleIds.map(() => '?').join(',')})`,
          )
          .all(...articleIds) as SnapshotWarningRow[])
      : [];

  return { articles, versions, links, bible_entries, bible_meta, warnings };
}

function persistSnapshot(worldId: string, name: string, data: SnapshotData): { id: string; name: string; created_at: number } {
  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO world_snapshots (id, world_id, name, data, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, worldId, name, JSON.stringify(data), now);
  return { id, name, created_at: now };
}

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/snapshots
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  const db = getDb();
  const { wid } = req.params as Record<string, string>;

  const world = db.prepare(`SELECT id FROM worlds WHERE id = ?`).get(wid);
  if (!world) {
    res.status(404).json({ error: 'World not found.' });
    return;
  }

  const snapshots = db
    .prepare(`SELECT id, name, created_at FROM world_snapshots WHERE world_id = ? ORDER BY created_at DESC`)
    .all(wid) as { id: string; name: string; created_at: number }[];

  res.json(snapshots);
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/snapshots
// ---------------------------------------------------------------------------

const CreateSnapshotSchema = z.object({
  name: z.string().min(1).max(200),
});

router.post('/', (req, res) => {
  const { wid } = req.params as Record<string, string>;
  const db = getDb();

  const world = db.prepare(`SELECT id FROM worlds WHERE id = ?`).get(wid);
  if (!world) {
    res.status(404).json({ error: 'World not found.' });
    return;
  }

  const parsed = CreateSnapshotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
    return;
  }

  const data = captureSnapshot(wid);
  const snapshot = persistSnapshot(wid, parsed.data.name, data);
  res.status(201).json(snapshot);
});

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/snapshots/:sid   — preview (article titles only)
// ---------------------------------------------------------------------------

router.get('/:sid', (req, res) => {
  const { wid, sid } = req.params as Record<string, string>;
  const db = getDb();

  const row = db
    .prepare(`SELECT id, name, created_at, data FROM world_snapshots WHERE id = ? AND world_id = ?`)
    .get(sid, wid) as { id: string; name: string; created_at: number; data: string } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Snapshot not found.' });
    return;
  }

  const data = JSON.parse(row.data) as SnapshotData;

  // Return metadata + article list without full version bodies
  const articlePreviews = data.articles.map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    category_id: a.category_id,
  }));

  res.json({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    articleCount: data.articles.length,
    articles: articlePreviews,
  });
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/snapshots/:sid/restore
// ---------------------------------------------------------------------------

router.post('/:sid/restore', (req, res) => {
  const { wid, sid } = req.params as Record<string, string>;
  const db = getDb();

  const world = db.prepare(`SELECT id FROM worlds WHERE id = ?`).get(wid);
  if (!world) {
    res.status(404).json({ error: 'World not found.' });
    return;
  }

  const row = db
    .prepare(`SELECT id, name, data FROM world_snapshots WHERE id = ? AND world_id = ?`)
    .get(sid, wid) as { id: string; name: string; data: string } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Snapshot not found.' });
    return;
  }

  // Auto-save current state before overwriting
  const currentData = captureSnapshot(wid);
  const autoSaveName = `Auto-save before restore ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`;
  const autoSave = persistSnapshot(wid, autoSaveName, currentData);

  const target = JSON.parse(row.data) as SnapshotData;

  db.transaction(() => {
    // Wipe current world content (CASCADE handles versions, links, warnings, bible_entries, pending_drafts)
    db.prepare(`DELETE FROM articles WHERE world_id = ?`).run(wid);
    db.prepare(`DELETE FROM world_bible_entries WHERE world_id = ?`).run(wid);

    // Restore articles
    const insertArticle = db.prepare(`
      INSERT INTO articles
        (id, world_id, category_id, title, status, template_type,
         temporal_anchor_start, temporal_anchor_end, is_fixed_point,
         current_version_id, depth, created_at, updated_at)
      VALUES
        (@id, @world_id, @category_id, @title, @status, @template_type,
         @temporal_anchor_start, @temporal_anchor_end, @is_fixed_point,
         @current_version_id, @depth, @created_at, @updated_at)
    `);
    for (const a of target.articles) insertArticle.run(a);

    // Restore versions
    const insertVersion = db.prepare(`
      INSERT INTO article_versions
        (id, article_id, version_number, body, summary, expansion_params,
         proposal_used, word_count, is_revert, reverted_from_version_id, created_at)
      VALUES
        (@id, @article_id, @version_number, @body, @summary, @expansion_params,
         @proposal_used, @word_count, @is_revert, @reverted_from_version_id, @created_at)
    `);
    for (const v of target.versions) insertVersion.run(v);

    // Restore links
    const insertLink = db.prepare(`
      INSERT OR IGNORE INTO article_links (source_article_id, target_article_id, link_type)
      VALUES (@source_article_id, @target_article_id, @link_type)
    `);
    for (const l of target.links) insertLink.run(l);

    // Restore bible entries
    const insertBibleEntry = db.prepare(`
      INSERT INTO world_bible_entries (id, world_id, article_id, summary, sort_order, updated_at)
      VALUES (@id, @world_id, @article_id, @summary, @sort_order, @updated_at)
    `);
    for (const e of target.bible_entries) insertBibleEntry.run(e);

    // Restore bible meta
    if (target.bible_meta) {
      db.prepare(`
        INSERT INTO world_bible_meta (world_id, token_count, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(world_id) DO UPDATE SET token_count = excluded.token_count, updated_at = excluded.updated_at
      `).run(wid, target.bible_meta.token_count, target.bible_meta.updated_at);
    }

    // Restore coherence warnings
    const insertWarning = db.prepare(`
      INSERT OR IGNORE INTO coherence_warnings
        (id, article_id, source_article_id, severity, description, status, created_at)
      VALUES
        (@id, @article_id, @source_article_id, @severity, @description, @status, @created_at)
    `);
    for (const w of target.warnings) insertWarning.run(w);
  })();

  res.json({ restored: row.name, autoSaved: autoSave });
});

// ---------------------------------------------------------------------------
// DELETE /api/worlds/:wid/snapshots/:sid
// ---------------------------------------------------------------------------

router.delete('/:sid', (req, res) => {
  const { wid, sid } = req.params as Record<string, string>;
  const db = getDb();

  const result = db
    .prepare(`DELETE FROM world_snapshots WHERE id = ? AND world_id = ?`)
    .run(sid, wid);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Snapshot not found.' });
    return;
  }

  res.status(204).send();
});

export default router;
