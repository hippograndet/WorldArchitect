import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';
import { GeneratedDraftContentSchema } from '../services/articlesSchemas.js';
import {
  parseArticle,
  parseVersion,
  requireArticleForTenant,
  type DbRow,
} from '../services/articlesMapper.js';
import {
  acceptDraft,
  ArticleServiceError,
  batchCreateChildArticles,
  revertArticleVersion,
  updateArticle,
} from '../services/articlesService.js';
import { discardPendingDraft, DraftServiceError, getPendingDraft, savePendingDraft } from '../services/draftsService.js';
import articleGraphRoutes from './articleGraph.js';
import articleIssuesRoutes from './articleIssues.js';
import articleMetadataRoutes from './articleMetadata.js';

const router = Router({ mergeParams: true });

function sendArticleServiceError(res: Response, err: ArticleServiceError) {
  res.status(err.status).json({
    error: err.message,
    ...(err.code ? { code: err.code } : {}),
    ...(err.details ? { details: err.details } : {}),
  });
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

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
  force: z.boolean().optional().default(false),
});

const SaveDraftSchema = z.object({
  // selectedProposal: stores the Phase 1 proposal chosen by user { title, direction }
  selectedProposal: z.record(z.unknown()).optional(),
  pipelineType: z
    .enum(['expand_description', 'create_root', 'create_child', 'reorganize'])
    .optional()
    .default('expand_description'),
  autoSelect: z.boolean().optional().default(false),
  expansionParams: z.record(z.unknown()).optional().default({}),
  phase: z.enum([
    'draft_ready',
    'coherence_checked',
    'retention_checked',
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
  force: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Article CRUD
// ---------------------------------------------------------------------------

router.use(articleGraphRoutes);

// GET /api/worlds/:wid/articles?status=:s&q=:query
router.get('/', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const { status, q, category } = req.query as Record<string, string | undefined>;

  let sql = 'SELECT * FROM articles WHERE world_id = ? AND owner_id = ?';
  const params: unknown[] = [worldId, ownerId];

  if (status) { sql += ' AND status = ?';   params.push(status); }
  if (q)      { sql += ' AND title LIKE ?'; params.push(`%${q}%`); }
  if (category) { sql += ' AND category_id = ?'; params.push(category); }

  sql += ' ORDER BY updated_at DESC';

  const rows = await getDbClient().all<DbRow>(sql, params);
  res.json(rows.map(parseArticle));
}));

// GET /api/worlds/:wid/articles/:aid — article + current version body
router.get('/:aid', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, tenant, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const version = article.current_version_id
    ? await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ?', [article.current_version_id])
    : undefined;

  const bibleEntry = await exec.get<{ summary: string }>(
    'SELECT summary FROM world_bible_entries WHERE article_id = ? AND owner_id = ?',
    [(req.params as Record<string, string>).aid, tenant.ownerId],
  );

  const links = await exec.all<DbRow>(`
    SELECT a.id, a.title, wbe.summary AS introduction,
           al.link_type AS linkType
    FROM article_links al
    JOIN articles a ON a.id = al.target_article_id
    LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
    WHERE al.source_article_id = ? AND al.owner_id = ?
  `, [(req.params as Record<string, string>).aid, tenant.ownerId]);

  const warnings = await exec.all<DbRow>(
    `SELECT * FROM coherence_warnings WHERE article_id = ? AND owner_id = ? AND status = 'open'`,
    [(req.params as Record<string, string>).aid, tenant.ownerId],
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

  const { worldId, ownerId } = requireTenantContext(req);
  try {
    const result = await updateArticle({
      ...parse.data,
      worldId,
      articleId: (req.params as Record<string, string>).aid,
      ownerId,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ArticleServiceError) {
      sendArticleServiceError(res, err);
      return;
    }
    throw err;
  }
}));

// DELETE /api/worlds/:wid/articles/:aid
router.delete('/:aid', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, tenant, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  await exec.run('DELETE FROM articles WHERE id = ? AND owner_id = ?', [(req.params as Record<string, string>).aid, tenant.ownerId]);
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/:aid/versions
router.get('/:aid/versions', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, tenant, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const rows = await exec.all<DbRow>(
    'SELECT * FROM article_versions WHERE article_id = ? AND owner_id = ? ORDER BY version_number DESC',
    [(req.params as Record<string, string>).aid, tenant.ownerId],
  );

  res.json(rows.map(parseVersion));
}));

// GET /api/worlds/:wid/articles/:aid/versions/:vid — preview one version
router.get('/:aid/versions/:vid', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, tenant, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const row = await exec.get<DbRow>(
    'SELECT * FROM article_versions WHERE id = ? AND article_id = ? AND owner_id = ?',
    [(req.params as Record<string, string>).vid, (req.params as Record<string, string>).aid, tenant.ownerId],
  );

  if (!row) { res.status(404).json({ error: 'Version not found' }); return; }

  res.json(parseVersion(row));
}));

// POST /api/worlds/:wid/articles/:aid/revert/:vid — revert to version (non-destructive)
router.post('/:aid/revert/:vid', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  try {
    const version = await revertArticleVersion({
      worldId,
      articleId: (req.params as Record<string, string>).aid,
      ownerId,
      versionId: (req.params as Record<string, string>).vid,
    });
    res.status(201).json(version);
  } catch (err) {
    if (err instanceof ArticleServiceError) {
      sendArticleServiceError(res, err);
      return;
    }
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

// GET /api/worlds/:wid/articles/:aid/draft — crash recovery
router.get('/:aid/draft', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  try {
    res.json(await getPendingDraft({ ...tenant, articleId: (req.params as Record<string, string>).aid }));
  } catch (err) {
    if (err instanceof DraftServiceError) {
      res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }
    throw err;
  }
}));

// POST /api/worlds/:wid/articles/:aid/draft — save / update draft
router.post('/:aid/draft', asyncHandler(async (req, res) => {
  const parse = SaveDraftSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const tenant = requireTenantContext(req);
  try {
    res.json(await savePendingDraft({
      ...tenant,
      articleId: (req.params as Record<string, string>).aid,
      ...parse.data,
    }));
  } catch (err) {
    if (err instanceof DraftServiceError) {
      res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }
    throw err;
  }
}));

// DELETE /api/worlds/:wid/articles/:aid/draft — discard draft
router.delete('/:aid/draft', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  try {
    await discardPendingDraft({ ...tenant, articleId: (req.params as Record<string, string>).aid });
    res.status(204).send();
  } catch (err) {
    if (err instanceof DraftServiceError) {
      res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }
    throw err;
  }
}));

// POST /api/worlds/:wid/articles/:aid/accept — commit draft as new version
router.post('/:aid/accept', asyncHandler(async (req, res) => {
  const parse = AcceptDraftSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { worldId, ownerId } = requireTenantContext(req);
  try {
    const result = await acceptDraft({
      worldId,
      articleId: (req.params as Record<string, string>).aid,
      ownerId,
      ...parse.data,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ArticleServiceError) {
      res.status(err.status).json({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }
    throw err;
  }
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

  try {
    const result = await batchCreateChildArticles({
      ...requireTenantContext(req),
      ...parse.data,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ArticleServiceError) {
      sendArticleServiceError(res, err);
      return;
    }
    throw err;
  }
}));

router.use(articleIssuesRoutes);
router.use(articleMetadataRoutes);

export default router;
