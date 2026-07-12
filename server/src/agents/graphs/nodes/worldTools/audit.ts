import { getDbClient } from '../../../../db/client.js';
import { AuditorAgent } from '../../../auditor.js';
import { callCtx } from '../shared.js';
import type { OrchestrationState } from '../../state.js';

type Partial_ = Partial<OrchestrationState>;

// ---------------------------------------------------------------------------
// audit — Auditor (world-wide coherence scan)
// ---------------------------------------------------------------------------

export async function loadAuditSummariesNode(state: OrchestrationState): Promise<Partial_> {
  const exec = getDbClient();

  let lastAuditTs = 0;
  if (state.focus === 'recent') {
    const lastRow = await exec.get<{ ts: number | null }>(
      `SELECT MAX(created_at) AS ts FROM world_issues WHERE world_id = ?${state.ownerId ? ' AND owner_id = ?' : ''}`,
      state.ownerId ? [state.worldId, state.ownerId] : [state.worldId],
    );
    lastAuditTs = lastRow?.ts ?? 0;
  }

  const articleFilters = [`a.world_id = ?`];
  const articleParams: unknown[] = [state.worldId];
  if (state.ownerId) {
    articleFilters.push(`a.owner_id = ?`);
    articleParams.push(state.ownerId);
  }
  if (state.focus === 'recent' && lastAuditTs > 0) {
    articleFilters.push(`a.updated_at > ?`);
    articleParams.push(lastAuditTs);
  }

  const rows = await exec.all<{ id: string; title: string; summary: string | null }>(
    `SELECT a.id, a.title, wbe.summary
     FROM articles a
     LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
     WHERE ${articleFilters.join(' AND ')}
     ORDER BY a.depth ASC, a.title ASC`,
    articleParams,
  );

  const linkRows = await exec.all<{
    source_article_id: string;
    target_article_id: string;
    link_type: string;
    target_title: string;
  }>(
    `SELECT al.source_article_id, al.target_article_id, al.link_type, a.title AS target_title
     FROM article_links al
     JOIN articles a ON a.id = al.target_article_id
     WHERE al.source_article_id IN (
       SELECT id FROM articles WHERE world_id = ?${state.ownerId ? ' AND owner_id = ?' : ''}
     )
       ${state.ownerId ? 'AND al.owner_id = ? AND a.owner_id = ?' : ''}`,
    state.ownerId ? [state.worldId, state.ownerId, state.ownerId, state.ownerId] : [state.worldId],
  );

  const linkMap = new Map<string, Array<{ targetId: string; targetTitle: string; linkType: string }>>();
  for (const row of linkRows) {
    if (!linkMap.has(row.source_article_id)) linkMap.set(row.source_article_id, []);
    linkMap.get(row.source_article_id)!.push({
      targetId: row.target_article_id,
      targetTitle: row.target_title,
      linkType: row.link_type,
    });
  }

  const articleSummaries = rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary ?? '',
    existingLinks: linkMap.get(r.id) ?? [],
  }));

  return { articleSummaries };
}

export async function auditorNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new AuditorAgent();
  const result = await agent.run(state.worldId, {
    worldContext: state.worldContext!,
    articleSummaries: state.articleSummaries,
    sampleSize: state.sampleSize,
  }, callCtx(state));
  return { edgeProposals: result.output.edgeProposals, globalWarnings: result.output.globalWarnings, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
