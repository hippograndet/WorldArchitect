import { getDbClient } from '../db/client.js';
import { logger } from '../observability/logger.js';

/**
 * Keeps the Postgres search_articles ranked index in sync with article
 * content. Call from every place an article's title or description actually
 * changes. Never throws — log-and-skip on failure, same pattern
 * dev-docs/future/design_rag.md specifies for its future embeddings work,
 * applied here to a lexical index instead. Deletion is handled by
 * ON DELETE CASCADE on `DELETE FROM articles`.
 */
export async function reindexArticle(worldId: string, articleId: string): Promise<void> {
  try {
    const exec = getDbClient();
    const row = await exec.get<{ title: string; description: string | null }>(`
      SELECT a.title, av.description
      FROM articles a
      LEFT JOIN article_versions av ON av.id = a.current_version_id
      WHERE a.id = ? AND a.world_id = ?
    `, [articleId, worldId]);
    if (!row) return; // article gone (e.g. deleted concurrently) — nothing to index

    const title = row.title ?? '';
    const description = row.description ?? '';
    const now = Date.now();

    await exec.run(`
      INSERT INTO article_search_index (article_id, world_id, title, description, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (article_id) DO UPDATE SET
        world_id    = excluded.world_id,
        title       = excluded.title,
        description = excluded.description,
        updated_at  = excluded.updated_at
    `, [articleId, worldId, title, description, now]);
  } catch (err) {
    logger.warn('searchIndex.reindexFailed', {
      worldId, articleId, err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Full clear-and-rebuild for one world — for the snapshot-restore path, which
 * bulk-replaces articles via raw SQL outside the normal service layer, so no
 * per-call-site reindexArticle() hook ever fires for it.
 */
export async function rebuildSearchIndexForWorld(worldId: string): Promise<void> {
  try {
    const exec = getDbClient();
    await exec.run('DELETE FROM article_search_index WHERE world_id = ?', [worldId]);
    const rows = await exec.all<{ id: string }>('SELECT id FROM articles WHERE world_id = ?', [worldId]);
    for (const row of rows) {
      await reindexArticle(worldId, row.id);
    }
  } catch (err) {
    logger.warn('searchIndex.rebuildFailed', { worldId, err: err instanceof Error ? err.message : String(err) });
  }
}
