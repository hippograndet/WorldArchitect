import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { runSyncRules } from '../services/syncRules.js';

const router = Router({ mergeParams: true });

type DbRow = Record<string, unknown>;

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/publish/staged
// List draft articles with their health state
// ---------------------------------------------------------------------------

router.get('/staged', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const db = getDb();

  const articles = db.prepare(`
    SELECT a.id, a.title, a.status, a.template_type, a.depth, a.updated_at,
           COALESCE(blocking.cnt, 0) AS blocking_issues,
           COALESCE(warn.cnt, 0) AS warning_issues
    FROM articles a
    LEFT JOIN (
      SELECT article_id, COUNT(*) AS cnt
      FROM article_issues WHERE severity = 'blocking' AND status = 'open'
      GROUP BY article_id
    ) blocking ON blocking.article_id = a.id
    LEFT JOIN (
      SELECT article_id, COUNT(*) AS cnt
      FROM article_issues WHERE severity = 'warning' AND status = 'open'
      GROUP BY article_id
    ) warn ON warn.article_id = a.id
    WHERE a.world_id = ? AND a.status = 'draft'
    ORDER BY a.depth ASC, a.title ASC
  `).all(wid) as DbRow[];

  res.json(articles.map(a => ({
    id: a.id,
    title: a.title,
    status: a.status,
    templateType: a.template_type,
    depth: a.depth,
    updatedAt: a.updated_at,
    blockingIssues: a.blocking_issues,
    warningIssues: a.warning_issues,
    health: (a.blocking_issues as number) > 0 ? 'blocking'
           : (a.warning_issues as number) > 0 ? 'warnings'
           : 'clean',
  })));
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/publish/check
// Run pre-publish checks on a set of article IDs
// ---------------------------------------------------------------------------

const CheckSchema = z.object({
  articleIds: z.array(z.string()).min(1).max(100),
});

router.post('/check', (req, res) => {
  const parse = CheckSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const wid = (req.params as Record<string, string>).wid;
  const { articleIds } = parse.data;

  // Re-run sync rules for freshness
  for (const aid of articleIds) {
    runSyncRules(wid, aid);
  }

  const db = getDb();
  const placeholders = articleIds.map(() => '?').join(', ');
  const issues = db.prepare(`
    SELECT ai.*, a.title AS article_title
    FROM article_issues ai
    JOIN articles a ON a.id = ai.article_id
    WHERE ai.article_id IN (${placeholders}) AND ai.status = 'open'
    ORDER BY ai.severity DESC, ai.created_at DESC
  `).all(...articleIds) as DbRow[];

  const summary = {
    blocking: issues.filter(i => i.severity === 'blocking').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    clean: articleIds.filter(aid => !issues.some(i => i.article_id === aid)).length,
  };

  res.json({
    summary,
    issues: issues.map(i => ({
      id: i.id,
      articleId: i.article_id,
      articleTitle: i.article_title,
      source: i.source,
      severity: i.severity,
      code: i.code,
      excerpt: i.excerpt ?? null,
      explanation: i.explanation,
      suggestion: i.suggestion ?? null,
      status: i.status,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /api/worlds/:wid/publish/commit
// Publish a set of articles (no blocking issues allowed unless force=true)
// ---------------------------------------------------------------------------

const CommitSchema = z.object({
  articleIds: z.array(z.string()).min(1).max(100),
  force: z.boolean().optional().default(false),
});

router.post('/commit', (req, res) => {
  const parse = CommitSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const wid = (req.params as Record<string, string>).wid;
  const { articleIds, force } = parse.data;
  const db = getDb();
  const now = Date.now();

  if (!force) {
    const placeholders = articleIds.map(() => '?').join(', ');
    const blocking = db.prepare(`
      SELECT COUNT(*) AS cnt FROM article_issues
      WHERE article_id IN (${placeholders}) AND severity = 'blocking' AND status = 'open'
    `).get(...articleIds) as { cnt: number };

    if (blocking.cnt > 0) {
      res.status(422).json({
        error: 'BLOCKING_ISSUES',
        message: `${blocking.cnt} blocking issue(s) must be resolved before publishing. Use force=true to override.`,
      });
      return;
    }
  }

  const publishedIds: string[] = [];
  db.transaction(() => {
    for (const aid of articleIds) {
      const article = db.prepare(`SELECT id, current_version_id FROM articles WHERE id = ? AND world_id = ?`).get(aid, wid) as { id: string; current_version_id: string } | undefined;
      if (!article) continue;

      db.prepare(`UPDATE articles SET status = 'published', updated_at = ? WHERE id = ?`).run(now, aid);

      if (article.current_version_id) {
        db.prepare(`UPDATE article_versions SET is_published = 1 WHERE id = ?`).run(article.current_version_id);
      }

      db.prepare(`
        INSERT INTO publish_history (id, world_id, article_id, version_id, published_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(nanoid(), wid, aid, article.current_version_id ?? null, now);

      publishedIds.push(aid);
    }
  })();

  res.json({ published: publishedIds, publishedAt: now });
});

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid/publish/history
// ---------------------------------------------------------------------------

router.get('/history', (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  const db = getDb();

  const rows = db.prepare(`
    SELECT ph.*, a.title AS article_title
    FROM publish_history ph
    JOIN articles a ON a.id = ph.article_id
    WHERE ph.world_id = ?
    ORDER BY ph.published_at DESC
    LIMIT 100
  `).all(wid) as DbRow[];

  res.json(rows.map(r => ({
    id: r.id,
    articleId: r.article_id,
    articleTitle: r.article_title,
    versionId: r.version_id ?? null,
    publishedAt: r.published_at,
  })));
});

export default router;
