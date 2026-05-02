import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

export interface BibleEntry {
  id: string;
  articleId: string;
  articleTitle: string;
  summary: string;
  updatedAt: number;
}

/**
 * Insert or update the World Bible summary for a single article.
 * The Bible is internal LLM context — it has no UI editor.
 */
export function upsertEntry(
  worldId: string,
  articleId: string,
  summary: string,
): void {
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO world_bible_entries (id, world_id, article_id, summary, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(article_id) DO UPDATE SET
      summary    = excluded.summary,
      updated_at = excluded.updated_at
  `).run(nanoid(), worldId, articleId, summary, now);

  refreshTokenCount(worldId);
}

/**
 * Return all Bible entries for a world, sorted alphabetically by article title.
 */
export function getEntries(worldId: string): BibleEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT wbe.id, wbe.article_id, wbe.summary, wbe.updated_at, a.title AS article_title
    FROM world_bible_entries wbe
    JOIN articles a ON a.id = wbe.article_id
    WHERE wbe.world_id = ?
    ORDER BY a.title
  `).all(worldId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id:           r.id as string,
    articleId:    r.article_id as string,
    articleTitle: r.article_title as string,
    summary:      r.summary as string,
    updatedAt:    r.updated_at as number,
  }));
}

/**
 * Render the World Bible as markdown for LLM context.
 * Format: ### Article Title\nsummary\n\n...
 */
export function renderBible(worldId: string): string {
  const entries = getEntries(worldId);
  if (entries.length === 0) return '';

  return entries
    .map((e) => `### ${e.articleTitle}\n${e.summary}`)
    .join('\n\n');
}

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

export function refreshTokenCount(worldId: string): number {
  const rendered = renderBible(worldId);
  const tokenCount = Math.ceil(rendered.length / 4);
  const now = Date.now();

  getDb()
    .prepare('UPDATE world_bible_meta SET token_count = ?, updated_at = ? WHERE world_id = ?')
    .run(tokenCount, now, worldId);

  return tokenCount;
}
