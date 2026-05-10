import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';

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

function insertIssue(issue: ArticleIssueInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO article_issues (id, world_id, article_id, source, severity, code, excerpt, explanation, suggestion, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(
    nanoid(),
    issue.worldId,
    issue.articleId,
    issue.source,
    issue.severity,
    issue.code,
    issue.excerpt ?? null,
    issue.explanation,
    issue.suggestion ?? null,
    Date.now(),
  );
}

function clearRuleIssues(articleId: string): void {
  getDb().prepare(
    `DELETE FROM article_issues WHERE article_id = ? AND source = 'rule'`,
  ).run(articleId);
}

/**
 * Runs all rule-based checks for a given article and writes results to article_issues.
 * Clears existing rule issues before re-running to avoid duplicates.
 */
export function runSyncRules(worldId: string, articleId: string): void {
  const db = getDb();

  clearRuleIssues(articleId);

  const article = db.prepare(`SELECT * FROM articles WHERE id = ? AND world_id = ?`).get(articleId, worldId) as DbRow | undefined;
  if (!article) return;

  const title = article.title as string;
  const temporalStart = article.temporal_anchor_start as string | null;
  const temporalEnd = article.temporal_anchor_end as string | null;
  const depth = article.depth as number;

  // 1. Temporal inversion
  if (temporalStart && temporalEnd && temporalStart > temporalEnd) {
    insertIssue({
      worldId, articleId,
      source: 'rule', severity: 'blocking', code: 'TEMPORAL_INVERSION',
      excerpt: `Start: ${temporalStart} / End: ${temporalEnd}`,
      explanation: `The temporal start "${temporalStart}" is after the temporal end "${temporalEnd}".`,
      suggestion: 'Swap or correct the temporal anchor values.',
    });
  }

  // 2. Dead references
  const links = db.prepare(
    `SELECT al.target_article_id FROM article_links al WHERE al.source_article_id = ?`,
  ).all(articleId) as { target_article_id: string }[];

  for (const link of links) {
    const target = db.prepare(`SELECT id FROM articles WHERE id = ?`).get(link.target_article_id);
    if (!target) {
      insertIssue({
        worldId, articleId,
        source: 'rule', severity: 'blocking', code: 'DEAD_REFERENCE',
        explanation: `Article references a deleted or non-existent article (id: ${link.target_article_id}).`,
        suggestion: 'Remove the broken link or restore the target article.',
      });
    }
  }

  // 3. Depth violations — link from depth n to target with depth m where m < n
  const depthViolations = db.prepare(`
    SELECT t.title AS targetTitle, t.depth AS targetDepth
    FROM article_links al
    JOIN articles t ON t.id = al.target_article_id
    WHERE al.source_article_id = ? AND t.depth < ?
  `).all(articleId, depth) as { targetTitle: string; targetDepth: number }[];

  for (const v of depthViolations) {
    insertIssue({
      worldId, articleId,
      source: 'rule', severity: 'blocking', code: 'DEPTH_VIOLATION',
      excerpt: `Link to "${v.targetTitle}" (depth ${v.targetDepth}) from depth ${depth}`,
      explanation: `An article at depth ${depth} cannot reference an article at a shallower depth ${v.targetDepth}.`,
      suggestion: `Remove the reference to "${v.targetTitle}" or restructure the hierarchy.`,
    });
  }

  // 4. Orphan article — non-root (depth > 1) with no hierarchical parent
  if (depth > 1) {
    const hasParent = db.prepare(
      `SELECT source_article_id FROM article_links WHERE target_article_id = ? AND link_type = 'hierarchical' LIMIT 1`,
    ).get(articleId);

    if (!hasParent) {
      insertIssue({
        worldId, articleId,
        source: 'rule', severity: 'warning', code: 'ORPHAN_ARTICLE',
        explanation: `Article "${title}" has depth ${depth} but no hierarchical parent link.`,
        suggestion: 'Attach this article to a parent via a hierarchical link, or set its depth to 1.',
      });
    }
  }

  // 5. Duplicate title
  const duplicate = db.prepare(
    `SELECT id FROM articles WHERE world_id = ? AND title = ? AND id != ? LIMIT 1`,
  ).get(worldId, title, articleId) as { id: string } | undefined;

  if (duplicate) {
    insertIssue({
      worldId, articleId,
      source: 'rule', severity: 'blocking', code: 'DUPLICATE_TITLE',
      excerpt: title,
      explanation: `Another article in this world has the same title: "${title}".`,
      suggestion: 'Rename one of the articles to avoid the conflict.',
    });
  }
}
