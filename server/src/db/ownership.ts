import type { QueryExecutor } from './executor.js';

/**
 * Replaces SQLite's `trg_*_owner_from_world` triggers: on Postgres (and on
 * SQLite once callers pass an explicit owner_id) there's no DB-level
 * inheritance, so every insert into a world-owned table must look up the
 * parent world's owner_id itself before writing the row.
 */
export async function ownerIdForWorld(exec: QueryExecutor, worldId: string): Promise<string> {
  const row = await exec.get<{ owner_id: string }>('SELECT owner_id FROM worlds WHERE id = ?', [worldId]);
  if (!row) throw new Error(`World ${worldId} not found`);
  return row.owner_id;
}

/** Replaces SQLite's `trg_*_owner_from_article` triggers — same idea, keyed off the parent article. */
export async function ownerIdForArticle(exec: QueryExecutor, articleId: string): Promise<string> {
  const row = await exec.get<{ owner_id: string }>('SELECT owner_id FROM articles WHERE id = ?', [articleId]);
  if (!row) throw new Error(`Article ${articleId} not found`);
  return row.owner_id;
}
