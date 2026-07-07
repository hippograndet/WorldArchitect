import { nanoid } from 'nanoid';
import { getDbClient } from '../db/client.js';
import { ownerIdForWorld } from '../db/ownership.js';

type DbRow = Record<string, unknown>;

export type IssueSeverity = 'blocking' | 'warning';
export type IssueSource = 'rule' | 'linter' | 'publish_check';
export type IssueStatus = 'open' | 'dismissed' | 'fixed';

export interface ArticleIssueInsert {
  worldId: string;
  articleId: string;
  source: IssueSource;
  severity: IssueSeverity;
  code: string;
  excerpt?: string;
  explanation: string;
  suggestion?: string;
}

async function insertIssue(issue: ArticleIssueInsert, ownerId: string): Promise<void> {
  await getDbClient().run(`
    INSERT INTO article_issues (id, world_id, owner_id, article_id, source, severity, code, excerpt, explanation, suggestion, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `, [
    nanoid(),
    issue.worldId,
    ownerId,
    issue.articleId,
    issue.source,
    issue.severity,
    issue.code,
    issue.excerpt ?? null,
    issue.explanation,
    issue.suggestion ?? null,
    Date.now(),
  ]);
}

async function clearRuleIssues(articleId: string, ownerId: string): Promise<void> {
  await getDbClient().run(
    `DELETE FROM article_issues WHERE article_id = ? AND owner_id = ? AND source = 'rule'`,
    [articleId, ownerId],
  );
}

/**
 * Runs all rule-based checks for a given article and writes results to article_issues.
 * Clears existing rule issues before re-running to avoid duplicates.
 */
export async function runSyncRules(worldId: string, articleId: string): Promise<void> {
  const exec = getDbClient();

  const article = await exec.get<DbRow>(`SELECT * FROM articles WHERE id = ? AND world_id = ?`, [articleId, worldId]);
  if (!article) return;

  const title = article.title as string;
  const temporalStart = article.temporal_anchor_start as string | null;
  const temporalEnd = article.temporal_anchor_end as string | null;
  const depth = article.depth as number;
  const ownerId = article.owner_id as string;
  await clearRuleIssues(articleId, ownerId);

  // 1. Temporal inversion
  if (temporalStart && temporalEnd && temporalStart > temporalEnd) {
    await insertIssue({
      worldId, articleId,
      source: 'rule', severity: 'blocking', code: 'TEMPORAL_INVERSION',
      excerpt: `Start: ${temporalStart} / End: ${temporalEnd}`,
      explanation: `The temporal start "${temporalStart}" is after the temporal end "${temporalEnd}".`,
      suggestion: 'Swap or correct the temporal anchor values.',
    }, ownerId);
  }

  // 2. Dead references
  const links = await exec.all<{ target_article_id: string }>(
    `SELECT al.target_article_id FROM article_links al WHERE al.source_article_id = ? AND al.owner_id = ?`,
    [articleId, ownerId],
  );

  for (const link of links) {
    const target = await exec.get(`SELECT id FROM articles WHERE id = ? AND owner_id = ?`, [link.target_article_id, ownerId]);
    if (!target) {
      await insertIssue({
        worldId, articleId,
        source: 'rule', severity: 'blocking', code: 'DEAD_REFERENCE',
        explanation: `Article references a deleted or non-existent article (id: ${link.target_article_id}).`,
        suggestion: 'Remove the broken link or restore the target article.',
      }, ownerId);
    }
  }

  // 3. Depth violations — link from depth n to target with depth m where m < n
  const depthViolations = await exec.all<{ targetTitle: string; targetDepth: number }>(`
    SELECT t.title AS targetTitle, t.depth AS targetDepth
    FROM article_links al
    JOIN articles t ON t.id = al.target_article_id
    WHERE al.source_article_id = ? AND al.owner_id = ? AND t.owner_id = ? AND t.depth < ?
  `, [articleId, ownerId, ownerId, depth]);

  for (const v of depthViolations) {
    await insertIssue({
      worldId, articleId,
      source: 'rule', severity: 'blocking', code: 'DEPTH_VIOLATION',
      excerpt: `Link to "${v.targetTitle}" (depth ${v.targetDepth}) from depth ${depth}`,
      explanation: `An article at depth ${depth} cannot reference an article at a shallower depth ${v.targetDepth}.`,
      suggestion: `Remove the reference to "${v.targetTitle}" or restructure the hierarchy.`,
    }, ownerId);
  }

  // 4. Orphan article — non-root (depth > 1) with no hierarchical parent
  if (depth > 1) {
    const hasParent = await exec.get(
      `SELECT source_article_id FROM article_links WHERE target_article_id = ? AND owner_id = ? AND link_type = 'hierarchical' LIMIT 1`,
      [articleId, ownerId],
    );

    if (!hasParent) {
      await insertIssue({
        worldId, articleId,
        source: 'rule', severity: 'warning', code: 'ORPHAN_ARTICLE',
        explanation: `Article "${title}" has depth ${depth} but no hierarchical parent link.`,
        suggestion: 'Attach this article to a parent via a hierarchical link, or set its depth to 1.',
      }, ownerId);
    }
  }

  // 5. Duplicate title
  const duplicate = await exec.get<{ id: string }>(
    `SELECT id FROM articles WHERE world_id = ? AND owner_id = ? AND title = ? AND id != ? LIMIT 1`,
    [worldId, ownerId, title, articleId],
  );

  if (duplicate) {
    await insertIssue({
      worldId, articleId,
      source: 'rule', severity: 'blocking', code: 'DUPLICATE_TITLE',
      excerpt: title,
      explanation: `Another article in this world has the same title: "${title}".`,
      suggestion: 'Rename one of the articles to avoid the conflict.',
    }, ownerId);
  }
}
