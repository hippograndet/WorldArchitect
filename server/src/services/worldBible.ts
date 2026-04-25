import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BibleEntry {
  id: string;
  articleId: string;
  articleTitle: string;
  categoryId: string;
  categoryName: string;
  categorySortOrder: number;
  summary: string;
  sortOrder: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Insert or update the World Bible summary for a single article.
 * Sort order mirrors the article's category so the rendered Bible
 * stays grouped by category without requiring an extra JOIN on every render.
 */
export function upsertEntry(
  worldId: string,
  articleId: string,
  summary: string,
): void {
  const db = getDb();
  const now = Date.now();

  const article = db
    .prepare('SELECT category_id FROM articles WHERE id = ?')
    .get(articleId) as { category_id: string } | undefined;

  if (!article) throw new Error(`Article ${articleId} not found`);

  const category = db
    .prepare('SELECT sort_order FROM categories WHERE id = ?')
    .get(article.category_id) as { sort_order: number } | undefined;

  const sortOrder = category?.sort_order ?? 0;

  db.prepare(`
    INSERT INTO world_bible_entries (id, world_id, article_id, summary, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id) DO UPDATE SET
      summary    = excluded.summary,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `).run(nanoid(), worldId, articleId, summary, sortOrder, now);

  refreshTokenCount(worldId);
}

/**
 * Return all Bible entries for a world, joined with article + category data.
 * Ordered by category sort order, then article title alphabetically.
 */
export function getEntries(worldId: string): BibleEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      wbe.id,
      wbe.article_id,
      wbe.summary,
      wbe.sort_order,
      wbe.updated_at,
      a.title   AS article_title,
      c.id      AS category_id,
      c.name    AS category_name,
      c.sort_order AS category_sort_order
    FROM world_bible_entries wbe
    JOIN articles   a ON a.id = wbe.article_id
    JOIN categories c ON c.id = a.category_id
    WHERE wbe.world_id = ?
    ORDER BY c.sort_order, a.title
  `).all(worldId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id:                r.id as string,
    articleId:         r.article_id as string,
    articleTitle:      r.article_title as string,
    categoryId:        r.category_id as string,
    categoryName:      r.category_name as string,
    categorySortOrder: r.category_sort_order as number,
    summary:           r.summary as string,
    sortOrder:         r.sort_order as number,
    updatedAt:         r.updated_at as number,
  }));
}

/**
 * Render the World Bible as a clean markdown string grouped by category.
 * This is the string passed to all LLM agents as context.
 *
 * Format:
 *   ## Category Name
 *
 *   ### Article Title
 *   summary text
 *
 *   ### Another Article
 *   summary text
 */
export function renderBible(worldId: string): string {
  const entries = getEntries(worldId);
  if (entries.length === 0) return '';

  const parts: string[] = [];
  let currentCategory = '';

  for (const entry of entries) {
    if (entry.categoryName !== currentCategory) {
      if (currentCategory !== '') parts.push('');
      parts.push(`## ${entry.categoryName}`);
      parts.push('');
      currentCategory = entry.categoryName;
    }
    parts.push(`### ${entry.articleTitle}`);
    parts.push(entry.summary);
    parts.push('');
  }

  return parts.join('\n').trimEnd();
}

/**
 * Return the materialised token count + threshold for a world.
 */
export function getBibleMeta(worldId: string): { tokenCount: number; threshold: number } {
  const db = getDb();

  const meta = db
    .prepare('SELECT token_count FROM world_bible_meta WHERE world_id = ?')
    .get(worldId) as { token_count: number } | undefined;

  const settings = db
    .prepare('SELECT bible_threshold FROM cost_settings WHERE world_id = ?')
    .get(worldId) as { bible_threshold: number } | undefined;

  return {
    tokenCount: meta?.token_count ?? 0,
    threshold:  settings?.bible_threshold ?? 80000,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Recompute and persist the token count for the full rendered Bible.
 * Uses a character-based approximation (~4 chars per token) in Blocks 1–4.
 * Block 5 replaces this with a real Anthropic count_tokens call.
 */
export function refreshTokenCount(worldId: string): number {
  const rendered = renderBible(worldId);
  const tokenCount = Math.ceil(rendered.length / 4);
  const now = Date.now();

  getDb()
    .prepare('UPDATE world_bible_meta SET token_count = ?, updated_at = ? WHERE world_id = ?')
    .run(tokenCount, now, worldId);

  return tokenCount;
}
