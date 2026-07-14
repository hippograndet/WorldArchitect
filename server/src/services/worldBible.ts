import { getDbClient } from '../db/client.js';
import { ownerParams, ownerPredicate } from '../db/tenantScope.js';
import type { QueryExecutor } from '../db/executor.js';

interface BibleRow {
  articleTitle: string;
  summary: string;
  categoryName: string | null;
}

/**
 * The World Bible is a derived view, not stored state: each article's
 * "introduction" IS its current article_versions row's introduction (via
 * articles.current_version_id) — there is no separate summary to keep in
 * sync. Rendering just reads the current version of every article in the
 * world, grouped by category.
 */
async function fetchBibleRows(exec: QueryExecutor, worldId: string, ownerId?: string): Promise<BibleRow[]> {
  const rows = await exec.all<Record<string, unknown>>(`
    SELECT a.title AS article_title, av.introduction AS summary, c.name AS category_name
    FROM articles a
    JOIN article_versions av ON av.id = a.current_version_id
    LEFT JOIN categories c ON c.id = a.category_id${ownerPredicate('c', ownerId)}
    WHERE a.world_id = ?${ownerPredicate('a', ownerId)}
    ORDER BY COALESCE(c.sort_order, 9999), c.name, a.title
  `, [...ownerParams(ownerId), worldId, ...ownerParams(ownerId)]);

  return rows.map((r) => ({
    articleTitle: r.article_title as string,
    summary: (r.summary as string) ?? '',
    categoryName: (r.category_name as string | null) ?? null,
  }));
}

/**
 * Render the World Bible as markdown for LLM context.
 * Format: ### Article Title\nsummary\n\n... grouped under ## Category headers.
 */
export async function renderBible(worldId: string, ownerId?: string): Promise<string> {
  const rows = await fetchBibleRows(getDbClient(), worldId, ownerId);
  if (rows.length === 0) return '';

  const parts: string[] = [];
  let currentCategory: string | null = null;
  for (const row of rows) {
    if (!row.summary.trim()) continue;
    if (row.categoryName !== currentCategory) {
      currentCategory = row.categoryName;
      if (currentCategory) parts.push(`## ${currentCategory}`);
    }
    parts.push(`### ${row.articleTitle}\n${row.summary}`);
  }
  return parts.join('\n\n');
}

export async function getBibleMeta(worldId: string, ownerId?: string): Promise<{ tokenCount: number; threshold: number }> {
  const exec = getDbClient();

  const rendered = await renderBible(worldId, ownerId);
  const tokenCount = Math.ceil(rendered.length / 4);

  const settings = await exec.get<{ bible_threshold: number }>(
    `SELECT bible_threshold FROM cost_settings WHERE world_id = ?${ownerId ? ' AND owner_id = ?' : ''}`,
    ownerId ? [worldId, ownerId] : [worldId],
  );

  return {
    tokenCount,
    threshold: settings?.bible_threshold ?? 80000,
  };
}
