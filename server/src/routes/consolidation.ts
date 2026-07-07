import { Router } from 'express';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireTenantContext } from '../tenant.js';

const router = Router({ mergeParams: true });

type DbRow = Record<string, unknown>;

interface ConsolidationIssue {
  id: string;
  scope: 'world' | 'article';
  severity: string;
  source: string;
  description: string;
  articleIds: string[];
  articleTitles: string[];
  status: string;
  createdAt: number;
  raw: Record<string, unknown>;
}

function parseArticleIssueRow(row: DbRow): ConsolidationIssue {
  return {
    id: row.id as string,
    scope: 'article',
    severity: row.severity as string,
    source: row.source as string,
    description: row.explanation as string,
    articleIds: [row.article_id as string],
    articleTitles: [(row.article_title as string) ?? (row.article_id as string)],
    status: row.status as string,
    createdAt: row.created_at as number,
    raw: {
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
    },
  };
}

function parseWorldIssueRow(row: DbRow, titleById: Map<string, string>): ConsolidationIssue {
  const articleIds = JSON.parse((row.article_ids as string) || '[]') as string[];
  return {
    id: row.id as string,
    scope: 'world',
    severity: row.severity as string,
    source: row.source as string,
    description: row.description as string,
    articleIds,
    articleTitles: articleIds.map((id) => titleById.get(id) ?? id),
    status: row.status as string,
    createdAt: row.created_at as number,
    raw: {
      id: row.id,
      worldId: row.world_id,
      severity: row.severity,
      type: row.type,
      description: row.description,
      articleIds,
      source: row.source,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

interface ListFilters {
  worldId: string;
  ownerId: string;
  status?: string[];
  severity?: string;
  scope?: 'world' | 'article';
  articleId?: string;
  query?: string;
}

async function fetchConsolidationIssues(filters: ListFilters): Promise<ConsolidationIssue[]> {
  const exec = getDbClient();
  const { worldId, ownerId, status, severity, scope, articleId, query } = filters;

  const results: ConsolidationIssue[] = [];

  if (scope !== 'world') {
    let sql = `
      SELECT ai.*, a.title AS article_title
      FROM article_issues ai
      JOIN articles a ON a.id = ai.article_id
      WHERE ai.world_id = ? AND ai.owner_id = ?
    `;
    const params: unknown[] = [worldId, ownerId];
    if (status?.length) { sql += ` AND ai.status IN (${status.map(() => '?').join(',')})`; params.push(...status); }
    if (severity) { sql += ` AND ai.severity = ?`; params.push(severity); }
    if (articleId) { sql += ` AND ai.article_id = ?`; params.push(articleId); }
    if (query) { sql += ` AND (ai.explanation LIKE ? OR ai.excerpt LIKE ?)`; params.push(`%${query}%`, `%${query}%`); }

    const rows = await exec.all<DbRow>(sql, params);
    results.push(...rows.map(parseArticleIssueRow));
  }

  if (scope !== 'article') {
    let sql = `SELECT * FROM world_issues WHERE world_id = ? AND owner_id = ?`;
    const params: unknown[] = [worldId, ownerId];
    if (status?.length) { sql += ` AND status IN (${status.map(() => '?').join(',')})`; params.push(...status); }
    if (severity) { sql += ` AND severity = ?`; params.push(severity); }
    if (articleId) { sql += ` AND article_ids LIKE ?`; params.push(`%"${articleId}"%`); }
    if (query) { sql += ` AND description LIKE ?`; params.push(`%${query}%`); }

    const rows = await exec.all<DbRow>(sql, params);

    const allIds = new Set<string>();
    for (const row of rows) {
      const ids = JSON.parse((row.article_ids as string) || '[]') as string[];
      for (const id of ids) allIds.add(id);
    }

    const titleById = new Map<string, string>();
    if (allIds.size > 0) {
      const idList = [...allIds];
      const titleRows = await exec.all<{ id: string; title: string }>(
        `SELECT id, title FROM articles WHERE world_id = ? AND owner_id = ? AND id IN (${idList.map(() => '?').join(',')})`,
        [worldId, ownerId, ...idList],
      );
      for (const t of titleRows) titleById.set(t.id, t.title);
    }

    results.push(...rows.map((row) => parseWorldIssueRow(row, titleById)));
  }

  results.sort((a, b) => b.createdAt - a.createdAt);
  return results;
}

// GET /api/worlds/:wid/consolidation-issues
router.get('/consolidation-issues', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const q = req.query as Record<string, string | undefined>;

  const status = q.status ? q.status.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const scope = q.scope === 'world' || q.scope === 'article' ? q.scope : undefined;

  const issues = await fetchConsolidationIssues({
    worldId,
    ownerId,
    status,
    severity: q.severity,
    scope,
    articleId: q.articleId,
    query: q.q,
  });

  res.json(issues);
}));

// GET /api/worlds/:wid/consolidation-issues/count
router.get('/consolidation-issues/count', asyncHandler(async (req, res) => {
  const { worldId, ownerId } = requireTenantContext(req);
  const exec = getDbClient();

  const [worldOpen, articleOpen] = await Promise.all([
    exec.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM world_issues WHERE world_id = ? AND owner_id = ? AND status IN ('open', 'in_review')`,
      [worldId, ownerId],
    ),
    exec.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM article_issues WHERE world_id = ? AND owner_id = ? AND status IN ('open', 'in_review')`,
      [worldId, ownerId],
    ),
  ]);

  res.json({ open: (worldOpen?.cnt ?? 0) + (articleOpen?.cnt ?? 0) });
}));

export default router;
