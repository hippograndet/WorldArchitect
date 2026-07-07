import type { QueryExecutor } from './executor.js';

/** Resolve the owning tenant before inserting into a world-owned table. */
export async function ownerIdForWorld(exec: QueryExecutor, worldId: string): Promise<string> {
  const row = await exec.get<{ owner_id: string }>('SELECT owner_id FROM worlds WHERE id = ?', [worldId]);
  if (!row) throw new Error(`World ${worldId} not found`);
  return row.owner_id;
}

/** Resolve the owning tenant through a parent article before inserting dependent rows. */
export async function ownerIdForArticle(exec: QueryExecutor, articleId: string): Promise<string> {
  const row = await exec.get<{ owner_id: string }>('SELECT owner_id FROM articles WHERE id = ?', [articleId]);
  if (!row) throw new Error(`Article ${articleId} not found`);
  return row.owner_id;
}
