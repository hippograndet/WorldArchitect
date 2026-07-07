import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';
import { LinterAgent } from '../agents/linter.js';
import { FixerAgent } from '../agents/fixer.js';
import { fetchWorldContext } from '../agents/director.js';
import { runSyncRules } from '../services/syncRules.js';
import { writeArticleVersionAndSetCurrent } from '../services/articleVersions.js';
import {
  getNextVersionNumber,
  parseArticle,
  parseVersion,
  requireArticleForTenant,
  type DbRow,
} from '../services/articlesMapper.js';

const router = Router({ mergeParams: true });

function parseIssue(row: DbRow) {
  return {
    id: row.id,
    worldId: row.world_id,
    articleId: row.article_id,
    source: row.source,
    severity: row.severity,
    code: row.code,
    excerpt: row.excerpt ?? null,
    explanation: row.explanation,
    suggestion: row.suggestion ?? null,
    status: row.status,
    createdAt: row.created_at,
  };
}

// GET /api/worlds/:wid/articles/:aid/issues
router.get('/:aid/issues', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, tenant, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const rows = await exec.all<DbRow>(
    `SELECT * FROM article_issues WHERE article_id = ? AND owner_id = ? AND status != 'dismissed' ORDER BY created_at DESC`,
    [(req.params as Record<string, string>).aid, tenant.ownerId],
  );

  res.json(rows.map(parseIssue));
}));

// POST /api/worlds/:wid/articles/:aid/lint — trigger LLM linter manually
router.post('/:aid/lint', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, tenant, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const worldContext = await fetchWorldContext(tenant.worldId);
  const linterAgent = new LinterAgent();

  try {
    await linterAgent.runAndPersist(tenant.worldId, (req.params as Record<string, string>).aid, worldContext);
    const rows = await exec.all<DbRow>(
      `SELECT * FROM article_issues WHERE article_id = ? AND owner_id = ? AND source = 'linter' ORDER BY created_at DESC`,
      [(req.params as Record<string, string>).aid, tenant.ownerId],
    );
    res.json(rows.map(parseIssue));
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
  const tenant = requireTenantContext(req);
  const issue = await exec.get(
    `SELECT id FROM article_issues WHERE id = ? AND article_id = ? AND owner_id = ?`,
    [(req.params as Record<string, string>).iid, (req.params as Record<string, string>).aid, tenant.ownerId],
  );

  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }

  await exec.run(`UPDATE article_issues SET status = ? WHERE id = ? AND owner_id = ?`, [body.status, (req.params as Record<string, string>).iid, tenant.ownerId]);

  res.json({ ok: true });
}));

// POST /api/worlds/:wid/articles/:aid/issues/:iid/fix — Fixer agent
router.post('/:aid/issues/:iid/fix', asyncHandler(async (req, res) => {
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, tenant, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const issue = await exec.get<DbRow>(
    `SELECT * FROM article_issues WHERE id = ? AND article_id = ? AND owner_id = ?`,
    [(req.params as Record<string, string>).iid, (req.params as Record<string, string>).aid, tenant.ownerId],
  );

  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return; }

  const currentVersion = article.current_version_id
    ? await exec.get<{ description: string }>('SELECT description FROM article_versions WHERE id = ?', [article.current_version_id])
    : undefined;

  const worldContext = await fetchWorldContext(tenant.worldId);
  const fixer = new FixerAgent();

  try {
    const result = await fixer.run(tenant.worldId, {
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
  const tenant = requireTenantContext(req);
  const exec = getDbClient();
  const article = await requireArticleForTenant(exec, tenant, (req.params as Record<string, string>).aid);
  if (!article) { res.status(404).json({ error: 'Article not found' }); return; }

  const body = req.body as { rewrittenPassage?: string; excerpt?: string };
  if (!body.rewrittenPassage || !body.excerpt) {
    res.status(400).json({ error: 'rewrittenPassage and excerpt are required' });
    return;
  }

  const issue = await exec.get(
    `SELECT id FROM article_issues WHERE id = ? AND article_id = ? AND owner_id = ?`,
    [(req.params as Record<string, string>).iid, (req.params as Record<string, string>).aid, tenant.ownerId],
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
    await writeArticleVersionAndSetCurrent(tx, {
      articleId: (req.params as Record<string, string>).aid,
      ownerId: tenant.ownerId,
      versionId,
      versionNumber,
      introduction: fixedIntro,
      description: newDesc,
      chronology: fixedChron,
      now,
    });
    await tx.run(`UPDATE article_issues SET status = 'fixed' WHERE id = ? AND owner_id = ?`, [(req.params as Record<string, string>).iid, tenant.ownerId]);
  });

  await runSyncRules(tenant.worldId, (req.params as Record<string, string>).aid);

  const updated = await exec.get<DbRow>('SELECT * FROM articles WHERE id = ? AND owner_id = ?', [(req.params as Record<string, string>).aid, tenant.ownerId]);
  const version = await exec.get<DbRow>('SELECT * FROM article_versions WHERE id = ? AND owner_id = ?', [versionId, tenant.ownerId]);

  res.status(201).json({ article: parseArticle(updated!), version: parseVersion(version!) });
}));

export default router;
