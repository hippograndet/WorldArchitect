import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import type { QueryExecutor } from '../db/executor.js';
import { upsertEntry } from '../services/worldBible.js';
import { runSyncRules } from '../services/syncRules.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { tenantIdFor } from '../tenant.js';

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

async function getNextVersionNumber(exec: QueryExecutor, articleId: string): Promise<number> {
  const row = await exec.get<{ max: number | null }>(
    'SELECT MAX(version_number) as max FROM article_versions WHERE article_id = ?',
    [articleId],
  );
  return (row?.max ?? 0) + 1;
}

async function requireArticle(exec: QueryExecutor, worldId: string, articleId: string): Promise<DbRow | null> {
  return (await exec.get<DbRow>('SELECT * FROM articles WHERE id = ? AND world_id = ?', [articleId, worldId])) ?? null;
}

// ---------------------------------------------------------------------------
// Article CRUD
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/tree — flat list with parentId for tree building
// Must be declared before /:aid to avoid 'tree' being matched as an article ID.
router.get('/tree', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;

  const rows = await getDbClient().all<{ id: string; title: string; status: string; depth: number; updated_at: number; parent_id: string | null }>(`
    SELECT a.id, a.title, a.status, a.depth, a.updated_at,
           al.source_article_id AS parent_id
    FROM articles a
    LEFT JOIN article_links al
      ON al.target_article_id = a.id AND al.link_type = 'hierarchical'
    WHERE a.world_id = ?
    ORDER BY a.depth ASC, a.updated_at ASC
  `, [wid]);

  res.json(rows.map((r) => ({
    id:       r.id,
    title:    r.title,
    status:   r.status,
    depth:    r.depth,
    parentId: r.parent_id ?? null,
  })));
}));

// GET /api/worlds/:wid/articles/graph — article network for graph view
router.get('/graph', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const exec = getDbClient();

  const nodes = await exec.all<{
    id: string;
    title: string;
    status: string;
    template_type: string;
    depth: number;
    introduction: string;
  }>(`
    SELECT a.id, a.title, a.status, a.template_type, a.depth,
           COALESCE(av.introduction, '') AS introduction
    FROM articles a
    LEFT JOIN article_versions av ON av.id = a.current_version_id
    WHERE a.world_id = ?
    ORDER BY a.depth ASC, a.title COLLATE NOCASE ASC
  `, [wid]);

  const edges = await exec.all<{
    source: string;
    target: string;
    linkType: 'hierarchical' | 'references';
  }>(`
    SELECT al.source_article_id AS source,
           al.target_article_id AS target,
           al.link_type AS linkType
    FROM article_links al
    JOIN articles source_article ON source_article.id = al.source_article_id
    JOIN articles target_article ON target_article.id = al.target_article_id
    WHERE source_article.world_id = ?
      AND target_article.world_id = ?
    ORDER BY al.link_type ASC
  `, [wid, wid]);

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
}));

// POST /api/worlds/:wid/articles/links — manually create or update an article edge
router.post('/links', asyncHandler(async (req, res) => {
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

  const exec = getDbClient();
  const articles = await exec.all<{ id: string; depth: number }>(`
    SELECT id, depth
    FROM articles
    WHERE world_id = ? AND id IN (?, ?)
  `, [wid, sourceArticleId, targetArticleId]);

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

      const children = await exec.all<{ id: string }>(`
        SELECT target_article_id AS id
        FROM article_links
        WHERE source_article_id = ? AND link_type = 'hierarchical'
      `, [currentId]);

      for (const child of children) queue.push(child.id);
    }
  }

  const now = Date.now();

  await exec.transaction(async (tx) => {
    if (linkType === 'hierarchical') {
      await tx.run(`
        DELETE FROM article_links
        WHERE target_article_id = ?
          AND link_type = 'hierarchical'
          AND source_article_id != ?
      `, [targetArticleId, sourceArticleId]);
    }

    await tx.run(`
      INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source_article_id, target_article_id)
      DO UPDATE SET link_type = excluded.link_type
    `, [sourceArticleId, targetArticleId, tenantIdFor(req), linkType]);

    if (linkType === 'hierarchical') {
      const queue = [{ id: targetArticleId, depth: (sourceArticle.depth ?? 1) + 1 }];
      const seen = new Set<string>([sourceArticleId]);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (seen.has(current.id)) continue;
        seen.add(current.id);

        await tx.run('UPDATE articles SET depth = ?, updated_at = ? WHERE id = ?', [current.depth, now, current.id]);

        const children = await tx.all<{ id: string }>(`
          SELECT target_article_id AS id
          FROM article_links
          WHERE source_article_id = ? AND link_type = 'hierarchical'
        `, [current.id]);

        for (const child of children) {
          queue.push({ id: child.id, depth: current.depth + 1 });
        }
      }
    }

    await tx.run('UPDATE articles SET updated_at = ? WHERE id IN (?, ?)', [now, sourceArticleId, targetArticleId]);
  });

  await runSyncRules(wid, sourceArticleId);
  await runSyncRules(wid, targetArticleId);

  res.status(201).json({
    source: sourceArticleId,
    target: targetArticleId,
    linkType,
  });
}));

// GET /api/worlds/:wid/articles?status=:s&q=:query
router.get('/', asyncHandler(async (req, res) => {
  const { status, q, category } = req.query as Record<string, string | undefined>;

  let sql = 'SELECT * FROM articles WHERE world_id = ?';
  const params: unknown[] = [(req.params as Record<string, string>).wid];

  if (status) { sql += ' AND status = ?';   params.push(status); }
  if (q)      { sql += ' AND title LIKE ?'; params.push(`%${q}%`); }
  if (category) { sql += ' AND category_id = ?'; params.push(category); }

  sql += ' ORDER BY updated_at DESC';

  const rows = await getDbClient().all<DbRow>(sql, params);
  res.json(rows.map(parseArticle));
}));

// POST /api/worlds/:wid/articles — create article manually
router.post('/', asyncHandler(async (req, res) => {
  const parse = CreateArticleSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const exec = getDbClient();

  const worldExists = await exec.get('SELECT id FROM worlds WHERE id = ?', [(req.params as Record<string, string>).wid]);
  if (!worldExists) { res.status(404).json({ error: 'World not found' }); return; }

  const {
    categoryId, title, templateType, introduction, body, chronology,
    temporalAnchorStart, temporalAnchorEnd, isFixedPoint,
  } = parse.data;
  const description = bodyToDescription(body, parse.data.description) ?? '';

  if (!categoryId) { res.status(400).json({ error: { categoryId: ['Required'] } }); return; }
  const categoryExists = await exec.get(
    'SELECT id FROM categories WHERE id = ? AND world_id = ?',
    [categoryId, (req.params as Record<string, string>).wid],
  );
  if (!categoryExists) { res.status(404).json({ error: 'Category not found' }); return; }

  const now = Date.now();
  const articleId = nanoid();
  const versionId = nanoid();
  const hasContent = description.trim() || chronology.trim() || introduction.trim();
  const status = hasContent ? 'draft' : 'stub';
  const ownerId = tenantIdFor(req);

  await exec.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO articles
        (id, world_id, owner_id, category_id, title, status, template_type,
         temporal_anchor_start, temporal_anchor_end, is_fixed_point,
         current_version_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      articleId, (req.params as Record<string, string>).wid, ownerId, categoryId, title, status, templateType,
      temporalAnchorStart ?? null, temporalAnchorEnd ?? null, isFixedPoint ? 1 : 0,
      versionId, now, now,
    ]);

    await tx.run(`
      INSERT INTO article_versions
        (id, article_id, owner_id, version_number, introduction, description, chronology, word_count, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    `, [versionId, articleId, ownerId, introduction, description, chronology,
        countWords(introduction + ' ' + description + ' ' + chronology), now]);
  });

  const article = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ?', [articleId]);
  const version = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ?', [versionId]);

  res.status(201).json({ article: parseArticle(article!), version: parseVersion(version!) });
}));

// GET /api/worlds/:wid/articles/:aid — article + current version body
router.get('/:aid', asyncHandler(async (req, res) => {
  const exec = getDbClient();
  const article = await requireArticle(exec, (req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const version = article.current_version_id
    ? await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ?', [article.current_version_id])
    : undefined;

  const bibleEntry = await exec.get<{ summary: string }>(
    'SELECT summary FROM world_bible_entries WHERE article_id = ?',
    [(req.params as Record<string, string>).aid],
  );

  const links = await exec.all<DbRow>(`
    SELECT a.id, a.title, wbe.summary AS introduction,
           al.link_type AS linkType
    FROM article_links al
    JOIN articles a ON a.id = al.target_article_id
    LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
    WHERE al.source_article_id = ?
  `, [(req.params as Record<string, string>).aid]);

  const warnings = await exec.all<DbRow>(
    `SELECT * FROM coherence_warnings WHERE article_id = ? AND status = 'open'`,
    [(req.params as Record<string, string>).aid],
  );

  res.json({
    article: parseArticle(article),
    version: version ? parseVersion(version) : null,
    introduction: bibleEntry?.summary ?? '',
    links,
    openWarnings: warnings,
  });
}));

// PATCH /api/worlds/:wid/articles/:aid — manual edit → new version
router.patch('/:aid', asyncHandler(async (req, res) => {
  const parse = ManualEditSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const exec = getDbClient();
  const article = await requireArticle(exec, (req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const now = Date.now();
  const versionId = nanoid();
  const versionNumber = await getNextVersionNumber(exec, (req.params as Record<string, string>).aid);

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
    ? await exec.get<{ introduction: string; description: string; chronology: string }>(
        'SELECT introduction, description, chronology FROM article_versions WHERE id = ?',
        [article.current_version_id],
      )
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

  await exec.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO article_versions
        (id, article_id, owner_id, version_number, introduction, description, chronology, word_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [versionId, (req.params as Record<string, string>).aid, tenantIdFor(req), versionNumber, newIntroduction, newDescription, newChronology,
        countWords(newIntroduction + ' ' + newDescription + ' ' + newChronology), now]);

    articleValues.push((req.params as Record<string, string>).aid);
    await tx.run(`UPDATE articles SET ${articleFields.join(', ')} WHERE id = ?`, articleValues);
  });

  // Run rule-based checks
  await runSyncRules((req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);

  const updated = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ?', [(req.params as Record<string, string>).aid]);
  const version = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ?', [versionId]);

  res.json({ article: parseArticle(updated!), version: parseVersion(version!) });
}));

// DELETE /api/worlds/:wid/articles/:aid
router.delete('/:aid', asyncHandler(async (req, res) => {
  const exec = getDbClient();
  const article = await requireArticle(exec, (req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  await exec.run('DELETE FROM articles WHERE id = ?', [(req.params as Record<string, string>).aid]);
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/:aid/versions
router.get('/:aid/versions', asyncHandler(async (req, res) => {
  const exec = getDbClient();
  const article = await requireArticle(exec, (req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const rows = await exec.all<DbRow>(
    'SELECT * FROM article_versions WHERE article_id = ? ORDER BY version_number DESC',
    [(req.params as Record<string, string>).aid],
  );

  res.json(rows.map(parseVersion));
}));

// GET /api/worlds/:wid/articles/:aid/versions/:vid — preview one version
router.get('/:aid/versions/:vid', asyncHandler(async (req, res) => {
  const exec = getDbClient();
  const article = await requireArticle(exec, (req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const row = await exec.get<DbRow>(
    'SELECT * FROM article_versions WHERE id = ? AND article_id = ?',
    [(req.params as Record<string, string>).vid, (req.params as Record<string, string>).aid],
  );

  if (!row) { res.status(404).json({ error: 'Version not found' }); return; }

  res.json(parseVersion(row));
}));

// POST /api/worlds/:wid/articles/:aid/revert/:vid — revert to version (non-destructive)
router.post('/:aid/revert/:vid', asyncHandler(async (req, res) => {
  const exec = getDbClient();
  const article = await requireArticle(exec, (req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const target = await exec.get<DbRow>(
    'SELECT * FROM article_versions WHERE id = ? AND article_id = ?',
    [(req.params as Record<string, string>).vid, (req.params as Record<string, string>).aid],
  );

  if (!target) { res.status(404).json({ error: 'Version not found' }); return; }

  const now = Date.now();
  const versionId = nanoid();
  const versionNumber = await getNextVersionNumber(exec, (req.params as Record<string, string>).aid);

  await exec.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO article_versions
        (id, article_id, owner_id, version_number, introduction, description, chronology, word_count,
         is_revert, reverted_from_version_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, [
      versionId, (req.params as Record<string, string>).aid, tenantIdFor(req), versionNumber,
      target.introduction, target.description, target.chronology, target.word_count,
      (req.params as Record<string, string>).vid, now,
    ]);

    await tx.run('UPDATE articles SET current_version_id = ?, updated_at = ? WHERE id = ?', [versionId, now, (req.params as Record<string, string>).aid]);
  });

  const newVersion = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ?', [versionId]);

  res.status(201).json(parseVersion(newVersion!));
}));

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/:aid/draft — crash recovery
router.get('/:aid/draft', asyncHandler(async (req, res) => {
  const exec = getDbClient();
  const article = await requireArticle(exec, (req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const row = await exec.get<DbRow>('SELECT * FROM pending_drafts WHERE article_id = ?', [(req.params as Record<string, string>).aid]);

  if (!row) { res.status(404).json({ error: 'No pending draft' }); return; }

  res.json(parseDraft(row));
}));

// POST /api/worlds/:wid/articles/:aid/draft — save / update draft
router.post('/:aid/draft', asyncHandler(async (req, res) => {
  const parse = SaveDraftSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const exec = getDbClient();
  const article = await requireArticle(exec, (req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const now = Date.now();
  const {
    selectedProposal, pipelineType, autoSelect, expansionParams,
    phase, contextPackage, concepts, parentUpdate, draftContent,
  } = parse.data;

  const selectedProposalJson = selectedProposal ? JSON.stringify(selectedProposal) : '{}';

  const existing = await exec.get<DbRow>('SELECT id FROM pending_drafts WHERE article_id = ?', [(req.params as Record<string, string>).aid]);

  if (existing) {
    await exec.run(`
      UPDATE pending_drafts
      SET selected_proposal = ?, draft_content = ?, expansion_params = ?,
          phase = ?, pipeline_type = ?, auto_select = ?,
          context_package = ?, concepts = ?, parent_update = ?, updated_at = ?
      WHERE article_id = ?
    `, [
      selectedProposalJson,
      draftContent ? JSON.stringify(draftContent) : null,
      JSON.stringify(expansionParams),
      phase, pipelineType, autoSelect ? 1 : 0,
      contextPackage ? JSON.stringify(contextPackage) : null,
      concepts ? JSON.stringify(concepts) : null,
      parentUpdate ? JSON.stringify(parentUpdate) : null,
      now,
      (req.params as Record<string, string>).aid,
    ]);
  } else {
    await exec.run(`
      INSERT INTO pending_drafts
        (id, article_id, owner_id, selected_proposal, draft_content, expansion_params,
         phase, pipeline_type, auto_select, context_package, concepts, parent_update,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      nanoid(), (req.params as Record<string, string>).aid, tenantIdFor(req),
      selectedProposalJson,
      draftContent ? JSON.stringify(draftContent) : null,
      JSON.stringify(expansionParams),
      phase, pipelineType, autoSelect ? 1 : 0,
      contextPackage ? JSON.stringify(contextPackage) : null,
      concepts ? JSON.stringify(concepts) : null,
      parentUpdate ? JSON.stringify(parentUpdate) : null,
      now, now,
    ]);
  }

  const row = await exec.get<DbRow>('SELECT * FROM pending_drafts WHERE article_id = ?', [(req.params as Record<string, string>).aid]);

  res.json(parseDraft(row!));
}));

// DELETE /api/worlds/:wid/articles/:aid/draft — discard draft
router.delete('/:aid/draft', asyncHandler(async (req, res) => {
  const exec = getDbClient();
  const article = await requireArticle(exec, (req.params as Record<string, string>).wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  await exec.run('DELETE FROM pending_drafts WHERE article_id = ?', [(req.params as Record<string, string>).aid]);
  res.status(204).send();
}));

// POST /api/worlds/:wid/articles/:aid/accept — commit draft as new version
router.post('/:aid/accept', asyncHandler(async (req, res) => {
  const parse = AcceptDraftSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const wid = (req.params as Record<string, string>).wid;
  const ownerId = tenantIdFor(req);
  const exec = getDbClient();
  const article = await requireArticle(exec, wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const draft = await exec.get<DbRow>('SELECT * FROM pending_drafts WHERE article_id = ?', [(req.params as Record<string, string>).aid]);

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
  const versionNumber = await getNextVersionNumber(exec, (req.params as Record<string, string>).aid);

  // Fetch current version fields
  const currentVersion = article.current_version_id
    ? await exec.get<{ introduction: string; description: string; chronology: string }>(
        'SELECT introduction, description, chronology FROM article_versions WHERE id = ?',
        [article.current_version_id],
      )
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

  await exec.transaction(async (tx) => {
    if (pipelineType === 'create_child') {
      // Two-write transaction: new child article + parent append
      const parentUpdate = draft.parent_update
        ? (JSON.parse(draft.parent_update as string) as { articleId: string; appendText: string })
        : null;

      const parentDepth = (article.depth as number) ?? 1;
      const childId = nanoid();
      const childVersionId = nanoid();

      await tx.run(`
        INSERT INTO articles
          (id, world_id, owner_id, title, status, template_type,
           depth, current_version_id, created_at, updated_at)
        SELECT ?, world_id, owner_id, title, 'draft', template_type,
               ?, ?, ?, ?
        FROM articles WHERE id = ?
      `, [childId, parentDepth + 1, childVersionId, now, now, (req.params as Record<string, string>).aid]);

      await tx.run(`
        INSERT INTO article_versions
          (id, article_id, owner_id, version_number, introduction, description, chronology, word_count, created_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      `, [childVersionId, childId, ownerId, newIntroduction, newDescription, newChronology,
          countWords(newIntroduction + ' ' + newDescription + ' ' + newChronology), now]);

      await tx.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'hierarchical')
        ON CONFLICT (source_article_id, target_article_id) DO NOTHING
      `, [(req.params as Record<string, string>).aid, childId, ownerId]);

      if (newIntroduction) {
        await upsertEntry(tx, wid, childId, newIntroduction);
      }

      if (parentUpdate?.appendText) {
        const parentVersionId = nanoid();
        const parentVersionNumber = await getNextVersionNumber(tx, (req.params as Record<string, string>).aid);
        const appendedDesc = currentDescription
          ? `${currentDescription}\n\n${parentUpdate.appendText}`
          : parentUpdate.appendText;

        await tx.run(`
          INSERT INTO article_versions
            (id, article_id, owner_id, version_number, introduction, description, chronology, word_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [parentVersionId, (req.params as Record<string, string>).aid, ownerId, parentVersionNumber,
            currentIntroduction, appendedDesc, currentChronology,
            countWords(currentIntroduction + ' ' + appendedDesc + ' ' + currentChronology), now]);

        await tx.run('UPDATE articles SET current_version_id = ?, updated_at = ? WHERE id = ?', [parentVersionId, now, (req.params as Record<string, string>).aid]);
      }

      childArticleId = childId;
    } else {
      // Single article write
      await tx.run(`
        INSERT INTO article_versions
          (id, article_id, owner_id, version_number, introduction, description, chronology,
           expansion_params, proposal_used, word_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        versionId, (req.params as Record<string, string>).aid, ownerId, versionNumber,
        newIntroduction, newDescription, newChronology,
        draft.expansion_params,
        draft.selected_proposal,
        countWords(newIntroduction + ' ' + newDescription + ' ' + newChronology),
        now,
      ]);

      const articleUpdates: unknown[] = [versionId, 'draft', now];
      let sql = 'UPDATE articles SET current_version_id = ?, status = ?, updated_at = ?';

      if (temporalAnchor) {
        sql += ', temporal_anchor_start = ?, temporal_anchor_end = ?';
        articleUpdates.push(temporalAnchor.start, temporalAnchor.end ?? null);
      }

      sql += ' WHERE id = ?';
      articleUpdates.push((req.params as Record<string, string>).aid);
      await tx.run(sql, articleUpdates);

      if (newIntroduction) {
        await upsertEntry(tx, wid, (req.params as Record<string, string>).aid, newIntroduction);
      }
    }

    // Insert coherence warnings
    for (const w of coherenceWarnings) {
      await tx.run(`
        INSERT INTO coherence_warnings
          (id, article_id, owner_id, source_article_id, severity, description, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
      `, [nanoid(), (req.params as Record<string, string>).aid, ownerId, w.sourceArticleId ?? null, w.severity, w.description, now]);
    }

    // Upsert article links (only for links with known target IDs)
    for (const link of suggestedLinks) {
      if (!link.targetArticleId) continue;
      await tx.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'references')
        ON CONFLICT (source_article_id, target_article_id) DO NOTHING
      `, [(req.params as Record<string, string>).aid, link.targetArticleId, ownerId]);
    }

    // Process entity mentions — create stubs for novel entities Scribe introduced
    const sourceDepth = (article.depth as number) ?? 1;
    const acceptedArticleId = pipelineType === 'create_child' ? childArticleId ?? (req.params as Record<string, string>).aid : (req.params as Record<string, string>).aid;
    for (const mention of mentions) {
      const existing = await tx.get<{ id: string; depth: number }>(
        `SELECT id, depth FROM articles WHERE world_id = ? AND title = ? LIMIT 1`,
        [wid, mention.title],
      );

      // Skip mentions that point to ancestors — they are parents/grandparents of the
      // accepted article, not novel subjects it introduces.
      if (existing && existing.depth < sourceDepth) continue;

      let targetId = existing?.id;

      if (!existing) {
        targetId = nanoid();
        const stubVersionId = nanoid();

        await tx.run(`
          INSERT INTO articles (id, world_id, owner_id, title, template_type, status, depth, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'stub', ?, ?, ?)
        `, [targetId, wid, ownerId, mention.title, mention.templateType ?? 'general', sourceDepth, now, now]);

        await tx.run(`
          INSERT INTO article_versions (id, article_id, owner_id, version_number, introduction, description, chronology, word_count, created_at)
          VALUES (?, ?, ?, 1, ?, ?, '', ?, ?)
        `, [stubVersionId, targetId, ownerId, mention.summary ?? '', '', countWords(mention.summary ?? ''), now]);

        await tx.run(`UPDATE articles SET current_version_id = ? WHERE id = ?`, [stubVersionId, targetId]);

        if (mention.summary) {
          await upsertEntry(tx, wid, targetId, mention.summary);
        }
      }

      await tx.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'references')
        ON CONFLICT (source_article_id, target_article_id) DO NOTHING
      `, [acceptedArticleId, targetId, ownerId]);

      await tx.run(`
        INSERT INTO entity_mentions (id, world_id, owner_id, source_article_id, article_id, title, template_type, summary, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?)
      `, [nanoid(), wid, ownerId, acceptedArticleId, targetId ?? null, mention.title, mention.templateType ?? 'general', mention.summary ?? null, now]);
    }

    await tx.run('DELETE FROM pending_drafts WHERE article_id = ?', [(req.params as Record<string, string>).aid]);
  });

  // Run rule-based checks (silent)
  await runSyncRules(wid, (req.params as Record<string, string>).aid);
  if (childArticleId) await runSyncRules(wid, childArticleId);

  const updatedArticle = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ?', [(req.params as Record<string, string>).aid]);

  if (pipelineType === 'create_child' && childArticleId) {
    const childArticle = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ?', [childArticleId]);
    const childVersion = await exec.get<DbRow>(
      'SELECT * FROM article_versions WHERE article_id = ? ORDER BY version_number DESC LIMIT 1',
      [childArticleId],
    );
    res.status(201).json({
      article: parseArticle(updatedArticle!),
      childArticle: parseArticle(childArticle!),
      childVersion: parseVersion(childVersion!),
    });
    return;
  }

  const newVersion = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ?', [versionId]);

  res.status(201).json({
    article: parseArticle(updatedArticle!),
    version: parseVersion(newVersion!),
  });
}));

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

router.post('/batch', asyncHandler(async (req, res) => {
  const parse = BatchCreateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const wid = (req.params as Record<string, string>).wid;
  const exec = getDbClient();

  const parent = await exec.get<DbRow>(
    'SELECT id, depth FROM articles WHERE id = ? AND world_id = ?',
    [parse.data.parentArticleId, wid],
  );

  if (!parent) { res.status(404).json({ error: 'Parent article not found' }); return; }

  const now = Date.now();
  const parentDepth = (parent.depth as number) ?? 1;
  const ownerId = tenantIdFor(req);
  const created: Array<{ id: string; title: string }> = [];

  await exec.transaction(async (tx) => {
    for (const child of parse.data.children) {
      const articleId = nanoid();
      const versionId = nanoid();

      await tx.run(`
        INSERT INTO articles
          (id, world_id, owner_id, title, status, template_type,
           depth, current_version_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'stub', ?, ?, ?, ?, ?)
      `, [
        articleId, wid, ownerId,
        child.title, child.templateType,
        parentDepth + 1, versionId, now, now,
      ]);

      await tx.run(`
        INSERT INTO article_versions
          (id, article_id, owner_id, version_number, introduction, description, chronology, word_count, created_at)
        VALUES (?, ?, ?, 1, ?, '', '', 0, ?)
      `, [versionId, articleId, ownerId, child.introduction, now]);

      await tx.run(`
        INSERT INTO article_links (source_article_id, target_article_id, owner_id, link_type)
        VALUES (?, ?, ?, 'hierarchical')
        ON CONFLICT (source_article_id, target_article_id) DO NOTHING
      `, [parse.data.parentArticleId, articleId, ownerId]);

      await upsertEntry(tx, wid, articleId, child.introduction);

      created.push({ id: articleId, title: child.title });
    }
  });

  res.status(201).json({ created });
}));

// ---------------------------------------------------------------------------
// Issues routes
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/:aid/issues
router.get('/:aid/issues', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const exec = getDbClient();
  const article = await requireArticle(exec, wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const rows = await exec.all<DbRow>(
    `SELECT * FROM article_issues WHERE article_id = ? AND status != 'dismissed' ORDER BY created_at DESC`,
    [(req.params as Record<string, string>).aid],
  );

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
}));

// POST /api/worlds/:wid/articles/:aid/lint — trigger LLM linter manually
import { LinterAgent } from '../agents/linter.js';
import { fetchWorldContext } from '../agents/director.js';

router.post('/:aid/lint', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const exec = getDbClient();
  const article = await requireArticle(exec, wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const worldContext = await fetchWorldContext(wid);
  const linterAgent = new LinterAgent();

  try {
    await linterAgent.runAndPersist(wid, (req.params as Record<string, string>).aid, worldContext);
    const rows = await exec.all<DbRow>(
      `SELECT * FROM article_issues WHERE article_id = ? AND source = 'linter' ORDER BY created_at DESC`,
      [(req.params as Record<string, string>).aid],
    );
    res.json(rows.map(r => ({
      id: r.id, worldId: r.world_id, articleId: r.article_id,
      source: r.source, severity: r.severity, code: r.code,
      excerpt: r.excerpt ?? null, explanation: r.explanation,
      suggestion: r.suggestion ?? null, status: r.status, createdAt: r.created_at,
    })));
  } catch (err) {
    console.error('Linter failed:', err);
    res.status(500).json({ error: 'Linter run failed' });
  }
}));

// PATCH /api/worlds/:wid/articles/:aid/issues/:iid — dismiss
router.patch('/:aid/issues/:iid', asyncHandler(async (req, res) => {
  const body = req.body as { status?: string };
  const validStatuses = ['open', 'dismissed', 'fixed'];

  if (!body.status || !validStatuses.includes(body.status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const exec = getDbClient();
  const issue = await exec.get(
    `SELECT id FROM article_issues WHERE id = ? AND article_id = ?`,
    [(req.params as Record<string, string>).iid, (req.params as Record<string, string>).aid],
  );

  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }

  await exec.run(`UPDATE article_issues SET status = ? WHERE id = ?`, [body.status, (req.params as Record<string, string>).iid]);

  res.json({ ok: true });
}));

// POST /api/worlds/:wid/articles/:aid/issues/:iid/fix — Fixer agent
import { FixerAgent } from '../agents/fixer.js';

router.post('/:aid/issues/:iid/fix', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const exec = getDbClient();
  const article = await requireArticle(exec, wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const issue = await exec.get<DbRow>(
    `SELECT * FROM article_issues WHERE id = ? AND article_id = ?`,
    [(req.params as Record<string, string>).iid, (req.params as Record<string, string>).aid],
  );

  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }

  const currentVersion = article.current_version_id
    ? await exec.get<{ description: string }>('SELECT description FROM article_versions WHERE id = ?', [article.current_version_id])
    : undefined;

  const worldContext = await fetchWorldContext(wid);
  const fixer = new FixerAgent();

  try {
    const result = await fixer.run(wid, {
      articleTitle: article.title as string,
      articleBody: currentVersion?.description ?? '',
      worldContext,
      excerpt: (issue.excerpt as string) ?? '',
      explanation: issue.explanation as string,
      suggestion: (issue.suggestion as string) ?? '',
    });
    res.json({ rewrittenPassage: result.output.rewrittenPassage });
  } catch (err) {
    console.error('Fixer failed:', err);
    res.status(500).json({ error: 'Fixer run failed' });
  }
}));

// POST /api/worlds/:wid/articles/:aid/issues/:iid/apply-fix
router.post('/:aid/issues/:iid/apply-fix', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const exec = getDbClient();
  const article = await requireArticle(exec, wid, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const body = req.body as { rewrittenPassage?: string; excerpt?: string };
  if (!body.rewrittenPassage || !body.excerpt) {
    res.status(400).json({ error: 'rewrittenPassage and excerpt are required' });
    return;
  }

  const issue = await exec.get(
    `SELECT id FROM article_issues WHERE id = ? AND article_id = ?`,
    [(req.params as Record<string, string>).iid, (req.params as Record<string, string>).aid],
  );

  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }

  const currentVersion = article.current_version_id
    ? await exec.get<{ introduction: string; description: string; chronology: string }>(
        'SELECT introduction, description, chronology FROM article_versions WHERE id = ?',
        [article.current_version_id],
      )
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
  const versionNumber = await getNextVersionNumber(exec, (req.params as Record<string, string>).aid);

  await exec.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO article_versions (id, article_id, owner_id, version_number, introduction, description, chronology, word_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [versionId, (req.params as Record<string, string>).aid, tenantIdFor(req), versionNumber, fixedIntro, newDesc, fixedChron,
        countWords(fixedIntro + ' ' + newDesc + ' ' + fixedChron), now]);

    await tx.run(`UPDATE articles SET current_version_id = ?, updated_at = ? WHERE id = ?`, [versionId, now, (req.params as Record<string, string>).aid]);
    await tx.run(`UPDATE article_issues SET status = 'fixed' WHERE id = ?`, [(req.params as Record<string, string>).iid]);
  });

  await runSyncRules(wid, (req.params as Record<string, string>).aid);

  const updated = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ?', [(req.params as Record<string, string>).aid]);
  const version = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ?', [versionId]);

  res.status(201).json({ article: parseArticle(updated!), version: parseVersion(version!) });
}));

export default router;
