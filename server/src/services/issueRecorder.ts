import { nanoid } from 'nanoid';
import type { QueryExecutor } from '../db/executor.js';

// ---------------------------------------------------------------------------
// Single home for the previously-inline article_issues / world_issues /
// auditor_edge_proposals writes that used to live duplicated across
// agents/linter.ts and routes/agents.ts. Same tables, same columns, same
// delete-old-then-insert-new semantics as before — pure extraction.
// ---------------------------------------------------------------------------

export interface RecordableIssue {
  severity: string;
  code?: string | null;
  excerpt?: string | null;
  explanation: string;
  suggestion?: string | null;
}

/** Replaces all `article_issues` rows for one (articleId, source) pair. */
export async function recordArticleIssues(
  exec: QueryExecutor,
  params: { worldId: string; ownerId: string; articleId: string; source: string; issues: RecordableIssue[] },
): Promise<void> {
  const { worldId, ownerId, articleId, source, issues } = params;
  const now = Date.now();

  await exec.run(`DELETE FROM article_issues WHERE article_id = ? AND source = ?`, [articleId, source]);

  for (const issue of issues) {
    await exec.run(
      `INSERT INTO article_issues (id, world_id, owner_id, article_id, source, severity, code, excerpt, explanation, suggestion, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [nanoid(), worldId, ownerId, articleId, source, issue.severity, issue.code ?? null, issue.excerpt ?? null, issue.explanation, issue.suggestion ?? null, now],
    );
  }
}

export interface RecordableGlobalWarning {
  severity: string;
  type: string;
  description: string;
  involvedArticleIds: string[];
}

/** Replaces all `status='open'` world_issues rows for a world (preserves dismissed/resolved/in_review). */
export async function recordWorldIssues(
  exec: QueryExecutor,
  params: { worldId: string; ownerId: string; source: string; warnings: RecordableGlobalWarning[] },
): Promise<void> {
  const { worldId, ownerId, source, warnings } = params;
  const now = Date.now();

  await exec.run(`DELETE FROM world_issues WHERE world_id = ? AND status = 'open'`, [worldId]);

  for (const gw of warnings) {
    await exec.run(
      `INSERT INTO world_issues (id, world_id, owner_id, severity, type, description, article_ids, source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [nanoid(), worldId, ownerId, gw.severity, gw.type, gw.description, JSON.stringify(gw.involvedArticleIds), source, now, now],
    );
  }
}

export interface RecordableEdgeProposal {
  sourceArticleId: string;
  targetArticleId: string;
  linkType: string;
  rationale: string;
}

/** Inserts pending edge proposals, skipping any whose source/target article no longer exists in the world. */
export async function recordProposedLinks(
  exec: QueryExecutor,
  params: { worldId: string; ownerId: string; proposals: RecordableEdgeProposal[] },
): Promise<void> {
  const { worldId, ownerId, proposals } = params;
  const now = Date.now();

  for (const ep of proposals) {
    const sourceExists = await exec.get('SELECT id FROM articles WHERE id = ? AND world_id = ?', [ep.sourceArticleId, worldId]);
    const targetExists = await exec.get('SELECT id FROM articles WHERE id = ? AND world_id = ?', [ep.targetArticleId, worldId]);
    if (!sourceExists || !targetExists) continue;

    await exec.run(
      `INSERT INTO auditor_edge_proposals
         (id, world_id, owner_id, source_article_id, target_article_id, link_type, rationale, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
       ON CONFLICT (id) DO NOTHING`,
      [nanoid(), worldId, ownerId, ep.sourceArticleId, ep.targetArticleId, ep.linkType, ep.rationale, now],
    );
  }
}
