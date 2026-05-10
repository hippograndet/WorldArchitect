import { z } from 'zod';
import { nanoid } from 'nanoid';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildLinterSystemPrompt, buildLinterUserMessage } from '../prompts/linter.js';
import type { WorldContext } from './director.js';
import { CONTEXT_TOOLS } from '../tools/context.js';
import { getDb } from '../db/index.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const LintIssueSchema = z.object({
  severity:    z.enum(['blocking', 'warning']),
  excerpt:     z.string().optional(),
  explanation: z.string(),
  suggestion:  z.string().optional(),
});

const SubmitLintReportSchema = z.object({
  issues: z.array(LintIssueSchema).default([]),
});

export interface LintIssue {
  severity:    'blocking' | 'warning';
  excerpt?:    string;
  explanation: string;
  suggestion?: string;
}

export interface LinterOutput {
  issues: LintIssue[];
}

export interface LinterInput {
  worldId:     string;
  articleId:   string;
  worldContext: WorldContext;
}

type DbRow = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class LinterAgent extends BaseAgent<LinterInput, LinterOutput> {
  readonly agentType = 'linter';
  readonly outputToolName = 'submit_lint_report';

  protected getMaxTokens(): number { return 1000; }

  protected getContextTools(): Tool[] {
    return CONTEXT_TOOLS;
  }

  protected buildMessages(worldId: string, input: LinterInput): ChatMessage[] {
    const db = getDb();

    const article = db.prepare(`
      SELECT a.title, a.template_type, a.depth, av.body, wbe.summary
      FROM articles a
      LEFT JOIN article_versions av ON av.id = a.current_version_id
      LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
      WHERE a.id = ? AND a.world_id = ?
    `).get(input.articleId, worldId) as DbRow | undefined;

    if (!article) {
      return [
        { role: 'system', content: buildLinterSystemPrompt(input.worldContext) },
        { role: 'user', content: 'Article not found.' },
      ];
    }

    const body = (article.body as string) ?? '';
    const depth = (article.depth as number) ?? 1;

    // Fetch parents
    const parents = db.prepare(`
      SELECT a.title, wbe.summary
      FROM article_links al
      JOIN articles a ON a.id = al.source_article_id
      LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
      WHERE al.target_article_id = ? AND al.link_type = 'hierarchical'
    `).all(input.articleId) as { title: string; summary: string }[];

    // Fetch siblings (same parent, excluding self)
    const parentIds = parents.map(p => p.title); // we use title for display
    const siblings: { title: string; summary: string }[] = [];
    if (depth > 1) {
      const parentRows = db.prepare(`
        SELECT source_article_id FROM article_links WHERE target_article_id = ? AND link_type = 'hierarchical' LIMIT 1
      `).get(input.articleId) as { source_article_id: string } | undefined;

      if (parentRows) {
        const sibRows = db.prepare(`
          SELECT a.title, wbe.summary
          FROM article_links al
          JOIN articles a ON a.id = al.target_article_id
          LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
          WHERE al.source_article_id = ? AND al.link_type = 'hierarchical' AND al.target_article_id != ?
          LIMIT 8
        `).all(parentRows.source_article_id, input.articleId) as { title: string; summary: string }[];
        siblings.push(...sibRows);
      }
    }

    // Fetch fixed points
    const fixedPoints = db.prepare(`
      SELECT a.title, wbe.summary
      FROM articles a
      LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
      WHERE a.world_id = ? AND a.is_fixed_point = 1
      LIMIT 5
    `).all(worldId) as { title: string; summary: string }[];

    void parentIds; // suppress unused warning

    return [
      { role: 'system', content: buildLinterSystemPrompt(input.worldContext) },
      {
        role: 'user',
        content: buildLinterUserMessage(
          article.title as string,
          body,
          { parents, siblings, fixedPoints },
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_lint_report;
  }

  protected parseOutput(input: Record<string, unknown>): LinterOutput {
    const parsed = SubmitLintReportSchema.parse(input);
    return { issues: parsed.issues };
  }

  /**
   * Run the linter and write results to article_issues.
   * Clears existing linter issues for the article before inserting new ones.
   */
  async runAndPersist(worldId: string, articleId: string, worldContext: WorldContext): Promise<void> {
    const db = getDb();
    db.prepare(`DELETE FROM article_issues WHERE article_id = ? AND source = 'linter'`).run(articleId);

    const result = await this.run(worldId, { worldId, articleId, worldContext });
    const now = Date.now();

    for (const issue of result.output.issues) {
      db.prepare(`
        INSERT INTO article_issues (id, world_id, article_id, source, severity, code, excerpt, explanation, suggestion, status, created_at)
        VALUES (?, ?, ?, 'linter', ?, 'SEMANTIC_ISSUE', ?, ?, ?, 'open', ?)
      `).run(nanoid(), worldId, articleId, issue.severity, issue.excerpt ?? null, issue.explanation, issue.suggestion ?? null, now);
    }
  }
}
