import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { upsertEntry } from '../services/worldBible.js';
import { runSyncRules } from '../services/syncRules.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateArticleSchema = z.object({
  categoryId: z.string().min(1).optional(),
  title: z.string().min(1).max(500),
  templateType: z
    .enum(['general', 'character', 'location', 'faction', 'historical_event'])
    .optional()
    .default('general'),
  introduction: z.string().optional().default(''),
  description: z.string().optional().default(''),
  chronology: z.string().optional().default(''),
  body: z.string().optional(),
  temporalAnchorStart: z.string().optional(),
  temporalAnchorEnd: z.string().optional(),
  isFixedPoint: z.boolean().optional().default(false),
});

const ManualEditSchema = z.object({
  body: z.string().optional(),
  introduction: z.string().optional(),
  description: z.string().optional(),
  chronology: z.string().optional(),
  status: z.enum(['stub', 'draft', 'reviewed']).optional(),
  title: z.string().min(1).max(500).optional(),
  temporalAnchorStart: z.string().nullable().optional(),
  temporalAnchorEnd: z.string().nullable().optional(),
  isFixedPoint: z.boolean().optional(),
});

const CoherenceWarningSchema = z.object({
  sourceArticleId: z.string().nullable().optional(),
  severity: z.enum(['warning', 'conflict']),
  description: z.string(),
});

const SuggestedLinkSchema = z.object({
  targetArticleTitle: z.string(),
  targetArticleId: z.string().nullable().optional(),
});

const TemporalAnchorSchema = z
  .object({ start: z.string(), end: z.string().optional() })
  .nullable()
  .optional();

const MentionSchema = z.object({
  title: z.string().min(1).max(500),
  templateType: z.enum(['general', 'character', 'location', 'faction', 'historical_event']).default('general'),
  summary: z.string().optional(),
});

const GeneratedDraftContentSchema = z.object({
  description: z.string().optional(),
  introduction: z.string().optional(),
  chronologySection: z.string().optional(),
  childDescription: z.string().optional(),
  parentAppend: z.string().optional(),
  coherenceWarnings: z.array(CoherenceWarningSchema).optional().default([]),
  suggestedLinks: z.array(SuggestedLinkSchema).optional().default([]),
  temporalAnchor: TemporalAnchorSchema,
  retentionIssues: z
    .array(z.object({ description: z.string(), severity: z.enum(['warning', 'critical']) }))
    .optional()
    .default([]),
  mentions: z.array(MentionSchema).optional().default([]),
});

const SaveDraftSchema = z.object({
  // selectedProposal: stores the Phase 1 proposal chosen by user { title, direction }
  selectedProposal: z.record(z.unknown()).optional(),
  pipelineType: z
    .enum(['expand_description', 'expand_chronology', 'create_root', 'create_child', 'reorganize'])
    .optional()
    .default('expand_description'),
  autoSelect: z.boolean().optional().default(false),
  expansionParams: z.record(z.unknown()).optional().default({}),
  phase: z.enum([
    'draft_ready',
    'coherence_checked',
    'retention_checked',
    'chronology_ready',
  ]),
  contextPackage: z.record(z.unknown()).optional(),
  concepts: z.array(z.record(z.unknown())).optional(),
  parentUpdate: z
    .object({ articleId: z.string(), appendText: z.string() })
    .optional(),
  // draftContent: flexible JSON blob stored by the Director; shape depends on pipelineType
  draftContent: GeneratedDraftContentSchema.optional(),
});

const AcceptDraftSchema = z.object({
  descriptionOverride: z.string().optional(),
  introductionOverride: z.string().optional(),
});

const CreateLinkSchema = z.object({
  sourceArticleId: z.string().min(1),
  targetArticleId: z.string().min(1),
  linkType: z.enum(['hierarchical', 'references']),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DbRow = Record<string, unknown>;

function parseArticle(row: DbRow) {
  return {
    id: row.id,
    worldId: row.world_id,
    title: row.title,
    status: row.status,
    templateType: row.template_type,
    depth: row.depth ?? 1,
    temporalAnchorStart: row.temporal_anchor_start ?? null,
    temporalAnchorEnd: row.temporal_anchor_end ?? null,
    isFixedPoint: row.is_fixed_point === 1,
    currentVersionId: row.current_version_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseVersion(row: DbRow) {
  const introduction = (row.introduction as string) ?? '';
  const description = (row.description as string) ?? '';
  const chronology = (row.chronology as string) ?? '';
  const body = [
    introduction ? `## Introduction\n\n${introduction}` : '',
    description ? `## Description\n\n${description}` : '',
    chronology ? `## Chronology\n\n${chronology}` : '',
  ].filter(Boolean).join('\n\n');
  const summary = introduction || description.split(/\s+/).filter(Boolean).slice(0, 50).join(' ');

  return {
    id: row.id,
    articleId: row.article_id,
    versionNumber: row.version_number,
    introduction,
    description,
    chronology,
    body,
    summary,
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
    selectedProposal: row.selected_proposal
      ? JSON.parse(row.selected_proposal as string)
      : null,
    pipelineType: (row.pipeline_type as string) ?? 'expand_description',
    autoSelect: row.auto_select === 1,
    expansionParams: row.expansion_params
      ? JSON.parse(row.expansion_params as string)
      : {},
    phase: row.phase,
    contextPackage: row.context_package
      ? JSON.parse(row.context_package as string)
      : null,
    concepts: row.concepts ? JSON.parse(row.concepts as string) : null,
    parentUpdate: row.parent_update
      ? JSON.parse(row.parent_update as string)
      : null,
    draftContent: row.draft_content
      ? JSON.parse(row.draft_content as string)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

function bodyToDescription(body: string | undefined, fallback?: string): string | undefined {
  if (body === undefined) return fallback;
  return body
    .replace(/^##\s+Description\s*/i, '')
    .replace(/^##\s+Introduction\s*[\s\S]*?##\s+Description\s*/i, '')
    .trim();
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

// GET /api/worlds/:wid/articles/tree — flat list with parentId for tree building
// Must be declared before /:aid to avoid 'tree' being matched as an article ID.
router.get('/tree', (req, res) => {
  const db = getDb();
  const wid = (req.params as Record<string, string>).wid;

  const rows = db.prepare(`
    SELECT a.id, a.title, a.status, a.depth, a.updated_at,
           al.source_article_id AS parent_id
    FROM articles a
    LEFT JOIN article_links al
      ON al.target_article_id = a.id AND al.link_type = 'hierarchical'
    WHERE a.world_id = ?
    ORDER BY a.depth ASC, a.updated_at ASC
  `).all(wid) as { id: string; title: string; status: string; depth: number; updated_at: number; parent_id: string | null }[];

  res.json(rows.map((r) => ({
    id:       r.id,
    title:    r.title,
    status:   r.status,
    depth:    r.depth,
    parentId: r.parent_id ?? null,
  })));
});

// GET /api/worlds/:wid/articles/graph — article network for graph view
router.get('/graph', (req, res) => {
  const db = getDb();
  const wid = (req.params as Record<string, string>).wid;

  const nodes = db.prepare(`
    SELECT a.id, a.title, a.status, a.template_type, a.depth,
           COALESCE(av.introduction, '') AS introduction
    FROM articles a
    LEFT JOIN article_versions av ON av.id = a.current_version_id
    WHERE a.world_id = ?
    ORDER BY a.depth ASC, a.title COLLATE NOCASE ASC
  `).all(wid) as {
    id: string;
    title: string;
    status: string;
    template_type: string;
    depth: number;
    introduction: string;
  }[];

  const edges = db.prepare(`
    SELECT al.source_article_id AS source,
           al.target_article_id AS target,
           al.link_type AS linkType
    FROM article_links al
    JOIN articles source_article ON source_article.id = al.source_article_id
    JOIN articles target_article ON target_article.id = al.target_article_id
    WHERE source_article.world_id = ?
      AND target_article.world_id = ?
    ORDER BY al.link_type ASC
  `).all(wid, wid) as {
    source: string;
    target: string;
    linkType: 'hierarchical' | 'references';
  }[];

  res.json({
    nodes: nodes.map((node) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      templateType: node.template_type,
      depth: node.depth ?? 1,
      introduction: node.introduction,
    })),
    edges,
  });
});

// POST /api/worlds/:wid/articles/links — manually create or update an article edge
router.post('/links', (req, res) => {
  const parse = CreateLinkSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { sourceArticleId, targetArticleId, linkType } = parse.data;
  const wid = (req.params as Record<string, string>).wid;

  if (sourceArticleId === targetArticleId) {
    res.status(400).json({ error: 'An article cannot link to itself.' });
    return;
  }

  const db = getDb();
  const articles = db.prepare(`
    SELECT id, depth
    FROM articles
    WHERE world_id = ? AND id IN (?, ?)
  `).all(wid, sourceArticleId, targetArticleId) as { id: string; depth: number }[];

  if (articles.length !== 2) {
    res.status(404).json({ error: 'Both articles must exist in this world.' });
    return;
  }

  const sourceArticle = articles.find((article) => article.id === sourceArticleId);
  const targetArticle = articles.find((article) => article.id === targetArticleId);
  if (!sourceArticle || !targetArticle) {
    res.status(404).json({ error: 'Both articles must exist in this world.' });
    return;
  }

  if (linkType === 'hierarchical') {
    const queue = [targetArticleId];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (currentId === sourceArticleId) {
        res.status(400).json({ error: 'That hierarchical edge would create a cycle.' });
        return;
      }
      if (seen.has(currentId)) continue;
      seen.add(currentId);

      const children = db.prepare(`
        SELECT target_article_id AS id
        FROM article_links
        WHERE source_article_id = ? AND link_type = 'hierarchical'
      `).all(currentId) as { id: string }[];

      for (const child of children) queue.push(child.id);
    }
  }

  const now = Date.now();

  db.transaction(() => {
    if (linkType === 'hierarchical') {
      db.prepare(`
        DELETE FROM article_links
        WHERE target_article_id = ?
          AND link_type = 'hierarchical'
          AND source_article_id != ?
      `).run(targetArticleId, sourceArticleId);
    }

    db.prepare(`
      INSERT INTO article_links (source_article_id, target_article_id, link_type)
      VALUES (?, ?, ?)
      ON CONFLICT(source_article_id, target_article_id)
      DO UPDATE SET link_type = excluded.link_type
    `).run(sourceArticleId, targetArticleId, linkType);

    if (linkType === 'hierarchical') {
      const queue = [{ id: targetArticleId, depth: (sourceArticle.depth ?? 1) + 1 }];
      const seen = new Set<string>([sourceArticleId]);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (seen.has(current.id)) continue;
        seen.add(current.id);

        db.prepare('UPDATE articles SET depth = ?, updated_at = ? WHERE id = ?')
          .run(current.depth, now, current.id);

        const children = db.prepare(`
          SELECT target_article_id AS id
          FROM article_links
          WHERE source_article_id = ? AND link_type = 'hierarchical'
        `).all(current.id) as { id: string }[];

        for (const child of children) {
          queue.push({ id: child.id, depth: current.depth + 1 });
        }
      }
    }

    db.prepare('UPDATE articles SET updated_at = ? WHERE id IN (?, ?)')
      .run(now, sourceArticleId, targetArticleId);
  })();

  runSyncRules(wid, sourceArticleId);
  runSyncRules(wid, targetArticleId);

  res.status(201).json({
    source: sourceArticleId,
    target: targetArticleId,
    linkType,
  });
});

// GET /api/worlds/:wid/articles?status=:s&q=:query
router.get('/', (req, res) => {
  const db = getDb();
  const { status, q, category } = req.query as Record<string, string | undefined>;

  let sql = 'SELECT * FROM articles WHERE world_id = ?';
  const params: unknown[] = [(req.params as Record<string, string>).wid];

  if (status) { sql += ' AND status = ?';   params.push(status); }
  if (q)      { sql += ' AND title LIKE ?'; params.push(`%${q}%`); }
  if (category) { sql += ' AND category_id = ?'; params.push(category); }

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

  const worldExists = db.prepare('SELECT id FROM worlds WHERE id = ?').get((req.params as Record<string, string>).wid);
  if (!worldExists) { res.status(404).json({ error: 'World not found' }); return; }

  const {
    categoryId, title, templateType, introduction, body, chronology,
    temporalAnchorStart, temporalAnchorEnd, isFixedPoint,
  } = parse.data;
  const description = bodyToDescription(body, parse.data.description) ?? '';

  if (!categoryId) { res.status(400).json({ error: { categoryId: ['Required'] } }); return; }
  const categoryExists = db
    .prepare('SELECT id FROM categories WHERE id = ? AND world_id = ?')
    .get(categoryId, (req.params as Record<string, string>).wid);
  if (!categoryExists) { res.status(404).json({ error: 'Category not found' }); return; }

  const now = Date.now();
  const articleId = nanoid();
  const versionId = nanoid();
  const hasContent = description.trim() || chronology.trim() || introduction.trim();
  const status = hasContent ? 'draft' : 'stub';

  db.transaction(() => {
    db.prepare(`
      INSERT INTO articles
        (id, world_id, category_id, title, status, template_type,
         temporal_anchor_start, temporal_anchor_end, is_fixed_point,
         current_version_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      articleId, (req.params as Record<string, string>).wid, categoryId, title, status, templateType,
      temporalAnchorStart ?? null, temporalAnchorEnd ?? null, isFixedPoint ? 1 : 0,
      versionId, now, now,
    );

    db.prepare(`
      INSERT INTO article_versions
        (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    `).run(versionId, articleId, introduction, description, chronology,
           countWords(introduction + ' ' + description + ' ' + chronology), now);
  })();

  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as DbRow;
  const version = db.prepare('SELECT * FROM article_versions WHERE id = ?').get(versionId) as DbRow;

  res.status(201).json({ article: parseArticle(article), version: parseVersion(version) });
});

// GET /api/worlds/:wid/articles/:aid — article + current version body
router.get('/:aid', (req, res) => {
  const article = requireArticle((req.params as Record<string, string>).wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const version = article.current_version_id
    ? (db
        .prepare('SELECT * FROM article_versions WHERE id = ?')
        .get(article.current_version_id) as DbRow | undefined)
    : undefined;

  const bibleEntry = db
    .prepare('SELECT summary FROM world_bible_entries WHERE article_id = ?')
    .get(req.params.aid) as { summary: string } | undefined;

  const links = db
    .prepare(`
      SELECT a.id, a.title, wbe.summary AS introduction,
             al.link_type AS linkType
      FROM article_links al
      JOIN articles a ON a.id = al.target_article_id
      LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
      WHERE al.source_article_id = ?
    `)
    .all(req.params.aid) as DbRow[];

  const warnings = db
    .prepare(`SELECT * FROM coherence_warnings WHERE article_id = ? AND status = 'open'`)
    .all(req.params.aid) as DbRow[];

  res.json({
    article: parseArticle(article),
    version: version ? parseVersion(version) : null,
    introduction: bibleEntry?.summary ?? '',
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

  const article = requireArticle((req.params as Record<string, string>).wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const now = Date.now();
  const versionId = nanoid();
  const versionNumber = getNextVersionNumber(req.params.aid);

  const { body, introduction, chronology, status, title, temporalAnchorStart, temporalAnchorEnd, isFixedPoint } = parse.data;
  const description = bodyToDescription(body, parse.data.description);

  if (
    body === undefined &&
    parse.data.description === undefined &&
    introduction === undefined &&
    chronology === undefined &&
    title === undefined &&
    temporalAnchorStart === undefined &&
    temporalAnchorEnd === undefined &&
    isFixedPoint === undefined
  ) {
    res.status(400).json({ error: 'No editable article fields provided' });
    return;
  }

  // Fetch current version to merge only the provided fields
  const current = article.current_version_id
    ? (db.prepare('SELECT introduction, description, chronology FROM article_versions WHERE id = ?')
        .get(article.current_version_id) as { introduction: string; description: string; chronology: string } | undefined)
    : undefined;

  const newIntroduction = introduction  ?? current?.introduction  ?? '';
  const newDescription  = description  ?? current?.description   ?? '';
  const newChronology   = chronology   ?? current?.chronology    ?? '';

  const hasContent = newDescription.trim() || newChronology.trim() || newIntroduction.trim();
  const effectiveStatus = status ?? (hasContent ? 'draft' : 'stub');

  const articleFields: string[] = ['updated_at = ?', 'current_version_id = ?', 'status = ?'];
  const articleValues: unknown[] = [now, versionId, effectiveStatus];

  if (title !== undefined)               { articleFields.push('title = ?');                  articleValues.push(title); }
  if (temporalAnchorStart !== undefined) { articleFields.push('temporal_anchor_start = ?'); articleValues.push(temporalAnchorStart); }
  if (temporalAnchorEnd !== undefined)   { articleFields.push('temporal_anchor_end = ?');   articleValues.push(temporalAnchorEnd); }
  if (isFixedPoint !== undefined)        { articleFields.push('is_fixed_point = ?');         articleValues.push(isFixedPoint ? 1 : 0); }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO article_versions
        (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(versionId, req.params.aid, versionNumber, newIntroduction, newDescription, newChronology,
           countWords(newIntroduction + ' ' + newDescription + ' ' + newChronology), now);

    articleValues.push(req.params.aid);
    db.prepare(`UPDATE articles SET ${articleFields.join(', ')} WHERE id = ?`).run(...articleValues);
  })();

  // Run rule-based checks
  runSyncRules((req.params as Record<string, string>).wid, req.params.aid);

  const updated = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.aid) as DbRow;
  const version = db.prepare('SELECT * FROM article_versions WHERE id = ?').get(versionId) as DbRow;

  res.json({ article: parseArticle(updated), version: parseVersion(version) });
});

// DELETE /api/worlds/:wid/articles/:aid
router.delete('/:aid', (req, res) => {
  const article = requireArticle((req.params as Record<string, string>).wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  getDb().prepare('DELETE FROM articles WHERE id = ?').run(req.params.aid);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/:aid/versions
router.get('/:aid/versions', (req, res) => {
  const article = requireArticle((req.params as Record<string, string>).wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const rows = getDb()
    .prepare('SELECT * FROM article_versions WHERE article_id = ? ORDER BY version_number DESC')
    .all(req.params.aid) as DbRow[];

  res.json(rows.map(parseVersion));
});

// GET /api/worlds/:wid/articles/:aid/versions/:vid — preview one version
router.get('/:aid/versions/:vid', (req, res) => {
  const article = requireArticle((req.params as Record<string, string>).wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const row = getDb()
    .prepare('SELECT * FROM article_versions WHERE id = ? AND article_id = ?')
    .get(req.params.vid, req.params.aid) as DbRow | undefined;

  if (!row) { res.status(404).json({ error: 'Version not found' }); return; }

  res.json(parseVersion(row));
});

// POST /api/worlds/:wid/articles/:aid/revert/:vid — revert to version (non-destructive)
router.post('/:aid/revert/:vid', (req, res) => {
  const article = requireArticle((req.params as Record<string, string>).wid, req.params.aid);
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
        (id, article_id, version_number, introduction, description, chronology, word_count,
         is_revert, reverted_from_version_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      versionId, req.params.aid, versionNumber,
      target.introduction, target.description, target.chronology, target.word_count,
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
  const article = requireArticle((req.params as Record<string, string>).wid, req.params.aid);
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

  const article = requireArticle((req.params as Record<string, string>).wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const now = Date.now();
  const {
    selectedProposal, pipelineType, autoSelect, expansionParams,
    phase, contextPackage, concepts, parentUpdate, draftContent,
  } = parse.data;

  const selectedProposalJson = selectedProposal ? JSON.stringify(selectedProposal) : '{}';

  const existing = db
    .prepare('SELECT id FROM pending_drafts WHERE article_id = ?')
    .get(req.params.aid) as DbRow | undefined;

  if (existing) {
    db.prepare(`
      UPDATE pending_drafts
      SET selected_proposal = ?, draft_content = ?, expansion_params = ?,
          phase = ?, pipeline_type = ?, auto_select = ?,
          context_package = ?, concepts = ?, parent_update = ?, updated_at = ?
      WHERE article_id = ?
    `).run(
      selectedProposalJson,
      draftContent ? JSON.stringify(draftContent) : null,
      JSON.stringify(expansionParams),
      phase, pipelineType, autoSelect ? 1 : 0,
      contextPackage ? JSON.stringify(contextPackage) : null,
      concepts ? JSON.stringify(concepts) : null,
      parentUpdate ? JSON.stringify(parentUpdate) : null,
      now,
      req.params.aid,
    );
  } else {
    db.prepare(`
      INSERT INTO pending_drafts
        (id, article_id, selected_proposal, draft_content, expansion_params,
         phase, pipeline_type, auto_select, context_package, concepts, parent_update,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nanoid(), req.params.aid,
      selectedProposalJson,
      draftContent ? JSON.stringify(draftContent) : null,
      JSON.stringify(expansionParams),
      phase, pipelineType, autoSelect ? 1 : 0,
      contextPackage ? JSON.stringify(contextPackage) : null,
      concepts ? JSON.stringify(concepts) : null,
      parentUpdate ? JSON.stringify(parentUpdate) : null,
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
  const article = requireArticle((req.params as Record<string, string>).wid, req.params.aid);
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

  const wid = (req.params as Record<string, string>).wid;
  const article = requireArticle(wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const draft = db
    .prepare('SELECT * FROM pending_drafts WHERE article_id = ?')
    .get(req.params.aid) as DbRow | undefined;

  if (!draft) { res.status(400).json({ error: 'No pending draft to accept' }); return; }

  const draftContentParse = draft.draft_content
    ? GeneratedDraftContentSchema.safeParse(JSON.parse(draft.draft_content as string))
    : null;

  if (draftContentParse && !draftContentParse.success) {
    res.status(400).json({
      error: 'Generated draft failed validation and was not accepted.',
      code: 'GENERATED_DRAFT_INVALID',
      details: draftContentParse.error.flatten().fieldErrors,
    });
    return;
  }

  const draftContent = draftContentParse?.data ?? null;

  if (!draftContent) {
    res.status(400).json({ error: 'Draft has no content yet (Phase 2 not run)' });
    return;
  }

  const pipelineType = (draft.pipeline_type as string) ?? 'expand_description';
  const coherenceWarnings = draftContent.coherenceWarnings ?? [];
  const suggestedLinks = draftContent.suggestedLinks ?? [];
  const temporalAnchor = draftContent.temporalAnchor ?? null;
  const mentions = draftContent.mentions ?? [];

  const now = Date.now();
  const versionId = nanoid();
  const versionNumber = getNextVersionNumber(req.params.aid);

  // Fetch current version fields
  const currentVersion = article.current_version_id
    ? (db.prepare('SELECT introduction, description, chronology FROM article_versions WHERE id = ?')
        .get(article.current_version_id) as { introduction: string; description: string; chronology: string } | undefined)
    : undefined;
  const currentDescription  = currentVersion?.description  ?? '';
  const currentChronology   = currentVersion?.chronology   ?? '';
  const currentIntroduction = currentVersion?.introduction ?? '';

  // Derive new field values based on pipeline type
  let newDescription:  string;
  let newChronology:   string;
  let newIntroduction: string;
  let childArticleId: string | null = null;

  if (pipelineType === 'expand_chronology') {
    newDescription  = currentDescription;
    newChronology   = parse.data.descriptionOverride ?? draftContent.chronologySection ?? '';
    newIntroduction = currentIntroduction;
  } else if (pipelineType === 'create_child') {
    newDescription  = '';
    newChronology   = '';
    newIntroduction = parse.data.introductionOverride ?? draftContent.introduction ?? draftContent.childDescription ?? '';
  } else {
    // expand_description | create_root | reorganize
    newDescription  = parse.data.descriptionOverride ?? draftContent.description ?? '';
    newChronology   = currentChronology;
    newIntroduction = parse.data.introductionOverride ?? draftContent.introduction ?? currentIntroduction;
  }

  db.transaction(() => {
    if (pipelineType === 'create_child') {
      // Two-write transaction: new child article + parent append
      const parentUpdate = draft.parent_update
        ? (JSON.parse(draft.parent_update as string) as { articleId: string; appendText: string })
        : null;

      const parentDepth = (article.depth as number) ?? 1;
      const childId = nanoid();
      const childVersionId = nanoid();

      db.prepare(`
        INSERT INTO articles
          (id, world_id, title, status, template_type,
           depth, current_version_id, created_at, updated_at)
        SELECT ?, world_id, title, 'draft', template_type,
               ?, ?, ?, ?
        FROM articles WHERE id = ?
      `).run(childId, parentDepth + 1, childVersionId, now, now, req.params.aid);

      db.prepare(`
        INSERT INTO article_versions
          (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?)
      `).run(childVersionId, childId, newIntroduction, newDescription, newChronology,
             countWords(newIntroduction + ' ' + newDescription + ' ' + newChronology), now);

      db.prepare(`
        INSERT OR IGNORE INTO article_links (source_article_id, target_article_id, link_type)
        VALUES (?, ?, 'hierarchical')
      `).run(req.params.aid, childId);

      if (newIntroduction) {
        upsertEntry(wid, childId, newIntroduction);
      }

      if (parentUpdate?.appendText) {
        const parentVersionId = nanoid();
        const parentVersionNumber = getNextVersionNumber(req.params.aid);
        const appendedDesc = currentDescription
          ? `${currentDescription}\n\n${parentUpdate.appendText}`
          : parentUpdate.appendText;

        db.prepare(`
          INSERT INTO article_versions
            (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(parentVersionId, req.params.aid, parentVersionNumber,
               currentIntroduction, appendedDesc, currentChronology,
               countWords(currentIntroduction + ' ' + appendedDesc + ' ' + currentChronology), now);

        db.prepare('UPDATE articles SET current_version_id = ?, updated_at = ? WHERE id = ?')
          .run(parentVersionId, now, req.params.aid);
      }

      childArticleId = childId;
    } else {
      // Single article write
      db.prepare(`
        INSERT INTO article_versions
          (id, article_id, version_number, introduction, description, chronology,
           expansion_params, proposal_used, word_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        versionId, req.params.aid, versionNumber,
        newIntroduction, newDescription, newChronology,
        draft.expansion_params,
        draft.selected_proposal,
        countWords(newIntroduction + ' ' + newDescription + ' ' + newChronology),
        now,
      );

      const articleUpdates: unknown[] = [versionId, 'draft', now];
      let sql = 'UPDATE articles SET current_version_id = ?, status = ?, updated_at = ?';

      if (temporalAnchor) {
        sql += ', temporal_anchor_start = ?, temporal_anchor_end = ?';
        articleUpdates.push(temporalAnchor.start, temporalAnchor.end ?? null);
      }

      sql += ' WHERE id = ?';
      articleUpdates.push(req.params.aid);
      db.prepare(sql).run(...articleUpdates);

      if (newIntroduction) {
        upsertEntry(wid, req.params.aid, newIntroduction);
      }
    }

    // Insert coherence warnings
    for (const w of coherenceWarnings) {
      db.prepare(`
        INSERT INTO coherence_warnings
          (id, article_id, source_article_id, severity, description, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'open', ?)
      `).run(nanoid(), req.params.aid, w.sourceArticleId ?? null, w.severity, w.description, now);
    }

    // Upsert article links (only for links with known target IDs)
    for (const link of suggestedLinks) {
      if (!link.targetArticleId) continue;
      db.prepare(`
        INSERT OR IGNORE INTO article_links (source_article_id, target_article_id, link_type)
        VALUES (?, ?, 'references')
      `).run(req.params.aid, link.targetArticleId);
    }

    // Process entity mentions — create stubs for novel entities Scribe introduced
    const sourceDepth = (article.depth as number) ?? 1;
    const acceptedArticleId = pipelineType === 'create_child' ? childArticleId ?? req.params.aid : req.params.aid;
    for (const mention of mentions) {
      const existing = db.prepare(
        `SELECT id, depth FROM articles WHERE world_id = ? AND title = ? LIMIT 1`,
      ).get(wid, mention.title) as { id: string; depth: number } | undefined;

      // Skip mentions that point to ancestors — they are parents/grandparents of the
      // accepted article, not novel subjects it introduces.
      if (existing && existing.depth < sourceDepth) continue;

      let targetId = existing?.id;

      if (!existing) {
        targetId = nanoid();
        const stubVersionId = nanoid();

        db.prepare(`
          INSERT INTO articles (id, world_id, title, template_type, status, depth, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'stub', ?, ?, ?)
        `).run(targetId, wid, mention.title, mention.templateType ?? 'general', sourceDepth, now, now);

        db.prepare(`
          INSERT INTO article_versions (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
          VALUES (?, ?, 1, ?, ?, '', ?, ?)
        `).run(stubVersionId, targetId, mention.summary ?? '', '', countWords(mention.summary ?? ''), now);

        db.prepare(`UPDATE articles SET current_version_id = ? WHERE id = ?`).run(stubVersionId, targetId);

        if (mention.summary) {
          upsertEntry(wid, targetId, mention.summary);
        }
      }

      db.prepare(`
        INSERT OR IGNORE INTO article_links (source_article_id, target_article_id, link_type)
        VALUES (?, ?, 'references')
      `).run(acceptedArticleId, targetId);

      db.prepare(`
        INSERT INTO entity_mentions (id, world_id, source_article_id, article_id, title, template_type, summary, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?)
      `).run(nanoid(), wid, acceptedArticleId, targetId ?? null, mention.title, mention.templateType ?? 'general', mention.summary ?? null, now);
    }

    db.prepare('DELETE FROM pending_drafts WHERE article_id = ?').run(req.params.aid);
  })();

  // Run rule-based checks (synchronous, silent)
  runSyncRules(wid, req.params.aid);
  if (childArticleId) runSyncRules(wid, childArticleId);

  const updatedArticle = db
    .prepare('SELECT * FROM articles WHERE id = ?')
    .get(req.params.aid) as DbRow;

  if (pipelineType === 'create_child' && childArticleId) {
    const childArticle = db.prepare('SELECT * FROM articles WHERE id = ?').get(childArticleId) as DbRow;
    const childVersion = db.prepare('SELECT * FROM article_versions WHERE article_id = ? ORDER BY version_number DESC LIMIT 1').get(childArticleId) as DbRow;
    return res.status(201).json({
      article: parseArticle(updatedArticle),
      childArticle: parseArticle(childArticle),
      childVersion: parseVersion(childVersion),
    });
  }

  const newVersion = db
    .prepare('SELECT * FROM article_versions WHERE id = ?')
    .get(versionId) as DbRow;

  res.status(201).json({
    article: parseArticle(updatedArticle),
    version: parseVersion(newVersion),
  });
});

// ---------------------------------------------------------------------------
// Batch stub creation — POST /api/worlds/:wid/articles/batch
// Creates N child stubs from ChildProposer-selected proposals. DB-only, no agent.
// ---------------------------------------------------------------------------

const BatchCreateSchema = z.object({
  parentArticleId: z.string().min(1),
  children: z.array(
    z.object({
      title: z.string().min(1).max(500),
      introduction: z.string().optional().default(''),
      templateType: z.enum(['general', 'character', 'location', 'faction', 'historical_event']),
    }),
  ).min(1).max(20),
});

router.post('/batch', (req, res) => {
  const parse = BatchCreateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const wid = (req.params as Record<string, string>).wid;
  const db = getDb();

  const parent = db
    .prepare('SELECT id, depth FROM articles WHERE id = ? AND world_id = ?')
    .get(parse.data.parentArticleId, wid) as DbRow | undefined;

  if (!parent) { res.status(404).json({ error: 'Parent article not found' }); return; }

  const now = Date.now();
  const parentDepth = (parent.depth as number) ?? 1;
  const created: Array<{ id: string; title: string }> = [];

  db.transaction(() => {
    for (const child of parse.data.children) {
      const articleId = nanoid();
      const versionId = nanoid();

      db.prepare(`
        INSERT INTO articles
          (id, world_id, title, status, template_type,
           depth, current_version_id, created_at, updated_at)
        VALUES (?, ?, ?, 'stub', ?, ?, ?, ?, ?)
      `).run(
        articleId, wid,
        child.title, child.templateType,
        parentDepth + 1, versionId, now, now,
      );

      db.prepare(`
        INSERT INTO article_versions
          (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
        VALUES (?, ?, 1, ?, '', '', 0, ?)
      `).run(versionId, articleId, child.introduction, now);

      db.prepare(`
        INSERT OR IGNORE INTO article_links (source_article_id, target_article_id, link_type)
        VALUES (?, ?, 'hierarchical')
      `).run(parse.data.parentArticleId, articleId);

      upsertEntry(wid, articleId, child.introduction);

      created.push({ id: articleId, title: child.title });
    }
  })();

  res.status(201).json({ created });
});

// ---------------------------------------------------------------------------
// Issues routes
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/:aid/issues
router.get('/:aid/issues', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const article = requireArticle(wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const rows = getDb().prepare(
    `SELECT * FROM article_issues WHERE article_id = ? AND status != 'dismissed' ORDER BY created_at DESC`,
  ).all(req.params.aid) as DbRow[];

  res.json(rows.map(r => ({
    id: r.id,
    worldId: r.world_id,
    articleId: r.article_id,
    source: r.source,
    severity: r.severity,
    code: r.code,
    excerpt: r.excerpt ?? null,
    explanation: r.explanation,
    suggestion: r.suggestion ?? null,
    status: r.status,
    createdAt: r.created_at,
  })));
});

// POST /api/worlds/:wid/articles/:aid/lint — trigger LLM linter manually
import { LinterAgent } from '../agents/linter.js';
import { fetchWorldContext } from '../agents/director.js';

router.post('/:aid/lint', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const article = requireArticle(wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const worldContext = fetchWorldContext(wid);
  const linterAgent = new LinterAgent();

  linterAgent.runAndPersist(wid, req.params.aid, worldContext)
    .then(() => {
      const rows = getDb().prepare(
        `SELECT * FROM article_issues WHERE article_id = ? AND source = 'linter' ORDER BY created_at DESC`,
      ).all(req.params.aid) as DbRow[];
      res.json(rows.map(r => ({
        id: r.id, worldId: r.world_id, articleId: r.article_id,
        source: r.source, severity: r.severity, code: r.code,
        excerpt: r.excerpt ?? null, explanation: r.explanation,
        suggestion: r.suggestion ?? null, status: r.status, createdAt: r.created_at,
      })));
    })
    .catch((err: unknown) => {
      console.error('Linter failed:', err);
      res.status(500).json({ error: 'Linter run failed' });
    });
});

// PATCH /api/worlds/:wid/articles/:aid/issues/:iid — dismiss
router.patch('/:aid/issues/:iid', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const body = req.body as { status?: string };
  const validStatuses = ['open', 'dismissed', 'fixed'];

  if (!body.status || !validStatuses.includes(body.status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const db = getDb();
  const issue = db.prepare(
    `SELECT id FROM article_issues WHERE id = ? AND article_id = ?`,
  ).get(req.params.iid, req.params.aid);

  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }

  db.prepare(`UPDATE article_issues SET status = ? WHERE id = ?`).run(body.status, req.params.iid);

  res.json({ ok: true });
});

// POST /api/worlds/:wid/articles/:aid/issues/:iid/fix — Fixer agent
import { FixerAgent } from '../agents/fixer.js';

router.post('/:aid/issues/:iid/fix', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const article = requireArticle(wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const db = getDb();
  const issue = db.prepare(
    `SELECT * FROM article_issues WHERE id = ? AND article_id = ?`,
  ).get(req.params.iid, req.params.aid) as DbRow | undefined;

  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }

  const currentVersion = article.current_version_id
    ? (db.prepare('SELECT description FROM article_versions WHERE id = ?').get(article.current_version_id) as { description: string } | undefined)
    : undefined;

  const worldContext = fetchWorldContext(wid);
  const fixer = new FixerAgent();

  fixer.run(wid, {
    articleTitle: article.title as string,
    articleBody: currentVersion?.description ?? '',
    worldContext,
    excerpt: (issue.excerpt as string) ?? '',
    explanation: issue.explanation as string,
    suggestion: (issue.suggestion as string) ?? '',
  }).then(result => {
    res.json({ rewrittenPassage: result.output.rewrittenPassage });
  }).catch((err: unknown) => {
    console.error('Fixer failed:', err);
    res.status(500).json({ error: 'Fixer run failed' });
  });
});

// POST /api/worlds/:wid/articles/:aid/issues/:iid/apply-fix
router.post('/:aid/issues/:iid/apply-fix', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const article = requireArticle(wid, req.params.aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const body = req.body as { rewrittenPassage?: string; excerpt?: string };
  if (!body.rewrittenPassage || !body.excerpt) {
    res.status(400).json({ error: 'rewrittenPassage and excerpt are required' });
    return;
  }

  const db = getDb();
  const issue = db.prepare(
    `SELECT id FROM article_issues WHERE id = ? AND article_id = ?`,
  ).get(req.params.iid, req.params.aid);

  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }

  const currentVersion = article.current_version_id
    ? (db.prepare('SELECT introduction, description, chronology FROM article_versions WHERE id = ?')
        .get(article.current_version_id) as { introduction: string; description: string; chronology: string } | undefined)
    : undefined;
  const currentDesc = currentVersion?.description ?? '';
  const newDesc = currentDesc.replace(body.excerpt, body.rewrittenPassage);

  if (newDesc === currentDesc) {
    res.status(400).json({ error: 'Excerpt not found in article description' });
    return;
  }

  const fixedIntro = currentVersion?.introduction ?? '';
  const fixedChron = currentVersion?.chronology ?? '';
  const now = Date.now();
  const versionId = nanoid();
  const versionNumber = getNextVersionNumber(req.params.aid);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO article_versions (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(versionId, req.params.aid, versionNumber, fixedIntro, newDesc, fixedChron,
           countWords(fixedIntro + ' ' + newDesc + ' ' + fixedChron), now);

    db.prepare(`UPDATE articles SET current_version_id = ?, updated_at = ? WHERE id = ?`).run(versionId, now, req.params.aid);
    db.prepare(`UPDATE article_issues SET status = 'fixed' WHERE id = ?`).run(req.params.iid);
  })();

  runSyncRules(wid, req.params.aid);

  const updated = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.aid) as DbRow;
  const version = db.prepare('SELECT * FROM article_versions WHERE id = ?').get(versionId) as DbRow;

  res.status(201).json({ article: parseArticle(updated), version: parseVersion(version) });
});

export default router;
