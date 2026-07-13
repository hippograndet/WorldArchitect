import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';
import { ownerParams, ownerPredicate } from '../db/tenantScope.js';
import type { QueryExecutor } from '../db/executor.js';

export interface BibleEntry {
  id: string;
  articleId: string;
  articleTitle: string;
  summary: string;
  updatedAt: number;
  categoryName: string | null;
  sortOrder: number;
}

async function getEntriesWithExecutor(exec: QueryExecutor, worldId: string, ownerId?: string): Promise<BibleEntry[]> {
  const ownerClause = ownerId ? 'AND wbe.owner_id = ? AND a.owner_id = ?' : '';
  const rows = await exec.all<Record<string, unknown>>(`
    SELECT wbe.id, wbe.article_id, wbe.summary, wbe.updated_at, wbe.sort_order,
           a.title AS article_title, c.name AS category_name
    FROM world_bible_entries wbe
    JOIN articles a ON a.id = wbe.article_id
    LEFT JOIN categories c ON c.id = a.category_id${ownerPredicate('c', ownerId)}
    WHERE wbe.world_id = ?
      ${ownerClause}
    ORDER BY wbe.sort_order, c.name, a.title
  `, ownerId ? [...ownerParams(ownerId), worldId, ownerId, ownerId] : [worldId]);

  return rows.map((r) => ({
    id:           r.id as string,
    articleId:    r.article_id as string,
    articleTitle: r.article_title as string,
    summary:      r.summary as string,
    updatedAt:    r.updated_at as number,
    categoryName: (r.category_name as string | null) ?? null,
    sortOrder:    r.sort_order as number,
  }));
}

async function renderBibleWithExecutor(exec: QueryExecutor, worldId: string, ownerId?: string): Promise<string> {
  const entries = await getEntriesWithExecutor(exec, worldId, ownerId);
  if (entries.length === 0) return '';

  const parts: string[] = [];
  let currentCategory: string | null = null;
  for (const entry of entries) {
    if (entry.categoryName !== currentCategory) {
      currentCategory = entry.categoryName;
      if (currentCategory) parts.push(`## ${currentCategory}`);
    }
    parts.push(`### ${entry.articleTitle}\n${entry.summary}`);
  }
  return parts.join('\n\n');
}

async function refreshTokenCountWithExecutor(exec: QueryExecutor, worldId: string, ownerId?: string): Promise<number> {
  const rendered = await renderBibleWithExecutor(exec, worldId, ownerId);
  const tokenCount = Math.ceil(rendered.length / 4);
  const now = Date.now();

  await exec.run(
    `UPDATE world_bible_meta SET token_count = ?, updated_at = ? WHERE world_id = ?${ownerId ? ' AND owner_id = ?' : ''}`,
    ownerId ? [tokenCount, now, worldId, ownerId] : [tokenCount, now, worldId],
  );

  return tokenCount;
}

/**
 * Insert or update the World Bible summary for a single article.
 * The Bible is internal LLM context — it has no UI editor.
 *
 * Takes an explicit QueryExecutor so callers inside an existing transaction
 * (e.g. article creation) can pass their `tx` and have this join that
 * transaction instead of opening a separate connection.
 */
export async function upsertEntry(
  exec: QueryExecutor,
  worldId: string,
  articleId: string,
  summary: string,
): Promise<void> {
  const now = Date.now();
  const article = await exec.get<{ id: string; sort_order: number; owner_id: string }>(`
    SELECT a.id, a.owner_id, COALESCE(c.sort_order, 9999) AS sort_order
    FROM articles a
    LEFT JOIN categories c ON c.id = a.category_id AND c.owner_id = a.owner_id
    WHERE a.id = ? AND a.world_id = ?
  `, [articleId, worldId]);

  if (!article) throw new Error(`Article ${articleId} not found in world ${worldId}`);

  await exec.run(`
    INSERT INTO world_bible_entries (id, world_id, owner_id, article_id, summary, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id) DO UPDATE SET
      summary    = excluded.summary,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `, [nanoid(), worldId, article.owner_id, articleId, summary, article.sort_order, now]);

  await refreshTokenCountWithExecutor(exec, worldId, article.owner_id);
}

/**
 * Read the current World Bible summary for a single article — the same
 * "current introduction" value the article page and Inception's accept path
 * both read/write. Callers that need "whatever the introduction currently
 * is" (e.g. carrying it forward into a new article_versions row) should use
 * this instead of `article_versions.introduction`, which is only a point-in-
 * time snapshot and does not get updated when Inception accepts a new one.
 */
export async function getEntrySummary(exec: QueryExecutor, worldId: string, articleId: string): Promise<string> {
  const row = await exec.get<{ summary: string }>(
    'SELECT summary FROM world_bible_entries WHERE world_id = ? AND article_id = ?',
    [worldId, articleId],
  );
  return row?.summary ?? '';
}

/**
 * Return all Bible entries for a world, sorted alphabetically by article title.
 */
export async function getEntries(worldId: string, ownerId?: string): Promise<BibleEntry[]> {
  return getEntriesWithExecutor(getDbClient(), worldId, ownerId);
}

/**
 * Render the World Bible as markdown for LLM context.
 * Format: ### Article Title\nsummary\n\n...
 */
export async function renderBible(worldId: string, ownerId?: string): Promise<string> {
  return renderBibleWithExecutor(getDbClient(), worldId, ownerId);
}

export async function getBibleMeta(worldId: string, ownerId?: string): Promise<{ tokenCount: number; threshold: number }> {
  const exec = getDbClient();

  const meta = await exec.get<{ token_count: number }>(
    `SELECT token_count FROM world_bible_meta WHERE world_id = ?${ownerId ? ' AND owner_id = ?' : ''}`,
    ownerId ? [worldId, ownerId] : [worldId],
  );

  const settings = await exec.get<{ bible_threshold: number }>(
    `SELECT bible_threshold FROM cost_settings WHERE world_id = ?${ownerId ? ' AND owner_id = ?' : ''}`,
    ownerId ? [worldId, ownerId] : [worldId],
  );

  return {
    tokenCount: meta?.token_count ?? 0,
    threshold:  settings?.bible_threshold ?? 80000,
  };
}

export async function refreshTokenCount(worldId: string, ownerId?: string): Promise<number> {
  return refreshTokenCountWithExecutor(getDbClient(), worldId, ownerId);
}
