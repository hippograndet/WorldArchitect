import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb } from '../db/index.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateArticleSchema = z.object({
  categoryId: z.string().min(1),
  title: z.string().min(1).max(500),
  templateType: z
    .enum(['general', 'character', 'location', 'faction', 'historical_event'])
    .optional()
    .default('general'),
  body: z.string().optional().default(''),
  summary: z.string().optional().default(''),
  temporalAnchorStart: z.string().optional(),
  temporalAnchorEnd: z.string().optional(),
  isFixedPoint: z.boolean().optional().default(false),
});

const ManualEditSchema = z.object({
  body: z.string(),
  summary: z.string().optional(),
  status: z.enum(['stub', 'draft', 'reviewed']).optional(),
  title: z.string().min(1).max(500).optional(),
  temporalAnchorStart: z.string().nullable().optional(),
  temporalAnchorEnd: z.string().nullable().optional(),
  isFixedPoint: z.boolean().optional(),
});

const SaveDraftSchema = z.object({
  selectedProposal: z.object({
    title: z.string(),
    summary: z.string(),
  }),
  expansionParams: z.record(z.unknown()),
  phase: z.enum(['proposal_selected', 'draft_ready']),
  draftContent: z
    .object({
      body: z.string(),
      summary: z.string(),
      coherenceWarnings: z
        .array(
          z.object({
            sourceArticleId: z.string().nullable().optional(),
            sourceArticleTitle: z.string().nullable().optional(),
            severity: z.enum(['warning', 'conflict']),
            description: z.string(),
          }),
        )
        .optional()
        .default([]),
      suggestedLinks: z
        .array(
          z.object({
            targetArticleTitle: z.string(),
            targetArticleId: z.string().nullable().optional(),
          }),
        )
        .optional()
        .default([]),
      temporalAnchor: z
        .object({ start: z.string(), end: z.string().optional() })
        .nullable()
        .optional(),
    })
    .optional(),
});

const AcceptDraftSchema = z.object({
  // Optional inline edit overrides — user may have edited the draft in the UI before accepting
  bodyOverride: z.string().optional(),
  summaryOverride: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DbRow = Record<string, unknown>;

function parseArticle(row: DbRow) {
  return {
    id: row.id,
    worldId: row.world_id,
    categoryId: row.category_id,
    title: row.title,
    status: row.status,
    templateType: row.template_type,
    temporalAnchorStart: row.temporal_anchor_start ?? null,
    temporalAnchorEnd: row.temporal_anchor_end ?? null,
    isFixedPoint: row.is_fixed_point === 1,
    currentVersionId: row.current_version_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseVersion(row: DbRow) {
  return {
    id: row.id,
    articleId: row.article_id,
    versionNumber: row.version_number,
    body: row.body,
    summary: row.summary,
    expansionParams: row.expansion_params
      ? JSON.parse(row.expansion_params as string)
      : null,
    proposalUsed: row.proposal_used
      ? JSON.parse(row.proposal_used as string)
      : null,
    wordCount: row.word_count,
    isRevert: row.is_revert === 1,
    revertedFromVersionId: row.reverted_from_version_id ?? null,
    createdAt: row.created_at,
  };
}

function parseDraft(row: DbRow) {
  return {
    id: row.id,
    articleId: row.article_id,
    selectedProposal: JSON.parse(row.selected_proposal as string),
    draftContent: row.draft_content
      ? JSON.parse(row.draft_content as string)
      : null,
    expansionParams: JSON.parse(row.expansion_params as string),
    phase: row.phase,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

function getNextVersionNumber(articleId: string): number {
  const db = getDb();
  const row = db
    .prepare('SELECT MAX(version_number) as max FROM article_versions WHERE article_id = ?')
    .get(articleId) as { max: number | null };
  return (row.max ?? 0) + 1;
}

function requireArticle(worldId: string, articleId: string): DbRow | null {
  const db = getDb();
  return (
    (db
      .prepare('SELECT * FROM articles WHERE id = ? AND world_id = ?')
      .get(articleId, worldId) as DbRow | undefined) ?? null
  );
}

// ---------------------------------------------------------------------------
// Article CRUD
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles?category=:cid&status=:s&q=:query
router.get('/', (req, res) => {
  const db = getDb();
  const { category, status, q } = req.query as Record<string, string | undefined>;

  let sql = 'SELECT * FROM articles WHERE world_id = ?';
  const params: unknown[] = [req.params.wid];

  if (category) { sql += ' AND category_id = ?';  params.push(category); }
  if (status)   { sql += ' AND status = ?';        params.push(status); }
  if (q)        { sql += ' AND title LIKE ?';      params.push(`%${q}%`); }

  sql += ' ORDER BY updated_at DESC';

  const rows = db.prepare(sql).all(...params) as DbRow[];
  res.json(rows.map(parseArticle));
});

// POST /api/worlds/:wid/articles — create article manually
router.post('/', (req, res) => {
  const parse = CreateArticleSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const db = getDb();

  // Verify world + category exist
  const worldExists = db.prepare('SELECT id FROM worlds WHERE id = ?').get(req.params.wid);
  if (!worldExists) { res.status(404).json({ error: 'World not found' }); return; }

  const categoryExists = db
    .prepare('SELECT id FROM categories WHERE id = ? AND world_id = ?')
    .get(parse.data.categoryId, req.params.wid);
  if (!categoryExists) { res.status(404).json({ error: 'Category not found' }); return; }

  const {
    categoryId, title, templateType, body, summary,
    temporalAnchorStart, temporalAnchorEnd, isFixedPoint,
  } = parse.data;

  const now = Date.now();
  const articleId = nanoid();
  const versionId = nanoid();
  const status = body.trim() === '' ? 'stub' : 'draft';

  db.transaction(() => {
    db.prepare(`
      INSERT INTO articles
        (id, world_id, category_id, title, status, template_type,
         temporal_anchor_start, temporal_anchor_end, is_fixed_point,
         current_version_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      articleId, req.params.wid, categoryId, title, status, templateType,
      temporalAnchorStart ?? null, temporalAnchorEnd ?? null, isFixedPoint ? 1 : 0,
      versionId, now, now,
    );

    db.prepare(`
      INSERT INTO article_versions
        (id, article_id, version_number, body, summary, word_count, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `).run(versionId, articleId, body, summary, countWords(body), now);
  })();

  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as DbRow;
  const version = db.prepare('SELECT * FROM article_versions WHERE id = ?').get(versionId) as DbRow;

  res.status(201).json({ article: parseArticle(article), version: parseVersion(version) });
});

// GET /api/worlds/:wid/articles/:aid — article + current version body
router.get('/:aid', (req, res) => {
  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const version = article.current_version_id
    ? (db
        .prepare('SELECT * FROM article_versions WHERE id = ?')
        .get(article.current_version_id) as DbRow | undefined)
    : undefined;

  const links = db
    .prepare(`
      SELECT a.id, a.title FROM article_links al
      JOIN articles a ON a.id = al.target_article_id
      WHERE al.source_article_id = ?
    `)
    .all(req.params.aid) as DbRow[];

  const warnings = db
    .prepare(`SELECT * FROM coherence_warnings WHERE article_id = ? AND status = 'open'`)
    .all(req.params.aid) as DbRow[];

  res.json({
    article: parseArticle(article),
    version: version ? parseVersion(version) : null,
    links,
    openWarnings: warnings,
  });
});

// PATCH /api/worlds/:wid/articles/:aid — manual edit → new version
router.patch('/:aid', (req, res) => {
  const parse = ManualEditSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const now = Date.now();
  const versionId = nanoid();
  const versionNumber = getNextVersionNumber(req.params.aid);

  const { body, summary, status, title, temporalAnchorStart, temporalAnchorEnd, isFixedPoint } = parse.data;

  // Derive summary from body if not provided
  const effectiveSummary = summary ?? body.trim().split(/\s+/).slice(0, 50).join(' ');
  const effectiveStatus = status ?? (body.trim() === '' ? 'stub' : 'draft');

  const articleFields: string[] = ['updated_at = ?', 'current_version_id = ?', 'status = ?'];
  const articleValues: unknown[] = [now, versionId, effectiveStatus];

  if (title !== undefined)               { articleFields.push('title = ?');                  articleValues.push(title); }
  if (temporalAnchorStart !== undefined) { articleFields.push('temporal_anchor_start = ?'); articleValues.push(temporalAnchorStart); }
  if (temporalAnchorEnd !== undefined)   { articleFields.push('temporal_anchor_end = ?');   articleValues.push(temporalAnchorEnd); }
  if (isFixedPoint !== undefined)        { articleFields.push('is_fixed_point = ?');         articleValues.push(isFixedPoint ? 1 : 0); }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO article_versions
        (id, article_id, version_number, body, summary, word_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(versionId, req.params.aid, versionNumber, body, effectiveSummary, countWords(body), now);

    articleValues.push(req.params.aid);
    db.prepare(`UPDATE articles SET ${articleFields.join(', ')} WHERE id = ?`).run(...articleValues);
  })();

  const updated = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.aid) as DbRow;
  const version = db.prepare('SELECT * FROM article_versions WHERE id = ?').get(versionId) as DbRow;

  res.json({ article: parseArticle(updated), version: parseVersion(version) });
});

// DELETE /api/worlds/:wid/articles/:aid
router.delete('/:aid', (req, res) => {
  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  getDb().prepare('DELETE FROM articles WHERE id = ?').run(req.params.aid);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/:aid/versions
router.get('/:aid/versions', (req, res) => {
  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const rows = getDb()
    .prepare('SELECT * FROM article_versions WHERE article_id = ? ORDER BY version_number DESC')
    .all(req.params.aid) as DbRow[];

  res.json(rows.map(parseVersion));
});

// GET /api/worlds/:wid/articles/:aid/versions/:vid — preview one version
router.get('/:aid/versions/:vid', (req, res) => {
  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const row = getDb()
    .prepare('SELECT * FROM article_versions WHERE id = ? AND article_id = ?')
    .get(req.params.vid, req.params.aid) as DbRow | undefined;

  if (!row) { res.status(404).json({ error: 'Version not found' }); return; }

  res.json(parseVersion(row));
});

// POST /api/worlds/:wid/articles/:aid/revert/:vid — revert to version (non-destructive)
router.post('/:aid/revert/:vid', (req, res) => {
  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const target = db
    .prepare('SELECT * FROM article_versions WHERE id = ? AND article_id = ?')
    .get(req.params.vid, req.params.aid) as DbRow | undefined;

  if (!target) { res.status(404).json({ error: 'Version not found' }); return; }

  const now = Date.now();
  const versionId = nanoid();
  const versionNumber = getNextVersionNumber(req.params.aid);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO article_versions
        (id, article_id, version_number, body, summary, word_count,
         is_revert, reverted_from_version_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      versionId, req.params.aid, versionNumber,
      target.body, target.summary, target.word_count,
      req.params.vid, now,
    );

    db.prepare('UPDATE articles SET current_version_id = ?, updated_at = ? WHERE id = ?')
      .run(versionId, now, req.params.aid);
  })();

  const newVersion = db
    .prepare('SELECT * FROM article_versions WHERE id = ?')
    .get(versionId) as DbRow;

  res.status(201).json(parseVersion(newVersion));
});

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/:aid/draft — crash recovery
router.get('/:aid/draft', (req, res) => {
  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const row = getDb()
    .prepare('SELECT * FROM pending_drafts WHERE article_id = ?')
    .get(req.params.aid) as DbRow | undefined;

  if (!row) { res.status(404).json({ error: 'No pending draft' }); return; }

  res.json(parseDraft(row));
});

// POST /api/worlds/:wid/articles/:aid/draft — save / update draft
router.post('/:aid/draft', (req, res) => {
  const parse = SaveDraftSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const now = Date.now();
  const { selectedProposal, expansionParams, phase, draftContent } = parse.data;

  const existing = db
    .prepare('SELECT id FROM pending_drafts WHERE article_id = ?')
    .get(req.params.aid) as DbRow | undefined;

  if (existing) {
    db.prepare(`
      UPDATE pending_drafts
      SET selected_proposal = ?, draft_content = ?, expansion_params = ?, phase = ?, updated_at = ?
      WHERE article_id = ?
    `).run(
      JSON.stringify(selectedProposal),
      draftContent ? JSON.stringify(draftContent) : null,
      JSON.stringify(expansionParams),
      phase,
      now,
      req.params.aid,
    );
  } else {
    db.prepare(`
      INSERT INTO pending_drafts
        (id, article_id, selected_proposal, draft_content, expansion_params, phase, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nanoid(), req.params.aid,
      JSON.stringify(selectedProposal),
      draftContent ? JSON.stringify(draftContent) : null,
      JSON.stringify(expansionParams),
      phase,
      now, now,
    );
  }

  const row = db
    .prepare('SELECT * FROM pending_drafts WHERE article_id = ?')
    .get(req.params.aid) as DbRow;

  res.json(parseDraft(row));
});

// DELETE /api/worlds/:wid/articles/:aid/draft — discard draft
router.delete('/:aid/draft', (req, res) => {
  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  getDb().prepare('DELETE FROM pending_drafts WHERE article_id = ?').run(req.params.aid);
  res.status(204).send();
});

// POST /api/worlds/:wid/articles/:aid/accept — commit draft as new version
router.post('/:aid/accept', (req, res) => {
  const parse = AcceptDraftSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const article = requireArticle(req.params.wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const draft = db
    .prepare('SELECT * FROM pending_drafts WHERE article_id = ?')
    .get(req.params.aid) as DbRow | undefined;

  if (!draft) { res.status(400).json({ error: 'No pending draft to accept' }); return; }

  const draftContent = draft.draft_content
    ? (JSON.parse(draft.draft_content as string) as {
        body: string;
        summary: string;
        coherenceWarnings?: Array<{
          sourceArticleId?: string | null;
          sourceArticleTitle?: string | null;
          severity: 'warning' | 'conflict';
          description: string;
        }>;
        suggestedLinks?: Array<{
          targetArticleTitle: string;
          targetArticleId?: string | null;
        }>;
        temporalAnchor?: { start: string; end?: string } | null;
      })
    : null;

  if (!draftContent) {
    res.status(400).json({ error: 'Draft has no content yet (Phase 2 not run)' });
    return;
  }

  // Inline edits override agent content
  const body = parse.data.bodyOverride ?? draftContent.body;
  const summary = parse.data.summaryOverride ?? draftContent.summary;
  const coherenceWarnings = draftContent.coherenceWarnings ?? [];
  const suggestedLinks = draftContent.suggestedLinks ?? [];
  const temporalAnchor = draftContent.temporalAnchor ?? null;

  const now = Date.now();
  const versionId = nanoid();
  const versionNumber = getNextVersionNumber(req.params.aid);

  db.transaction(() => {
    // 1. Create new version
    db.prepare(`
      INSERT INTO article_versions
        (id, article_id, version_number, body, summary,
         expansion_params, proposal_used, word_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId, req.params.aid, versionNumber,
      body, summary,
      draft.expansion_params,
      draft.selected_proposal,
      countWords(body),
      now,
    );

    // 2. Update article
    const articleUpdates: unknown[] = [versionId, 'draft', now];
    let sql = 'UPDATE articles SET current_version_id = ?, status = ?, updated_at = ?';

    if (temporalAnchor) {
      sql += ', temporal_anchor_start = ?, temporal_anchor_end = ?';
      articleUpdates.push(temporalAnchor.start, temporalAnchor.end ?? null);
    }

    sql += ' WHERE id = ?';
    articleUpdates.push(req.params.aid);
    db.prepare(sql).run(...articleUpdates);

    // 3. Insert coherence warnings
    for (const w of coherenceWarnings) {
      db.prepare(`
        INSERT INTO coherence_warnings
          (id, article_id, source_article_id, severity, description, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'open', ?)
      `).run(nanoid(), req.params.aid, w.sourceArticleId ?? null, w.severity, w.description, now);
    }

    // 4. Upsert article links (only for links with a known target ID)
    for (const link of suggestedLinks) {
      if (!link.targetArticleId) continue;
      db.prepare(`
        INSERT OR IGNORE INTO article_links (source_article_id, target_article_id)
        VALUES (?, ?)
      `).run(req.params.aid, link.targetArticleId);
    }

    // 5. Remove the pending draft
    db.prepare('DELETE FROM pending_drafts WHERE article_id = ?').run(req.params.aid);
  })();

  const updatedArticle = db
    .prepare('SELECT * FROM articles WHERE id = ?')
    .get(req.params.aid) as DbRow;
  const newVersion = db
    .prepare('SELECT * FROM article_versions WHERE id = ?')
    .get(versionId) as DbRow;

  res.status(201).json({
    article: parseArticle(updatedArticle),
    version: parseVersion(newVersion),
  });
});

export default router;
