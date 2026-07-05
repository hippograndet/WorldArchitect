import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildLinterSystemPrompt, buildLinterUserMessage } from '../prompts/linter.js';
import type { WorldContext } from './director.js';
import { CONTEXT_TOOLS } from '../tools/context.js';
import { getDbClient } from '../db/client.js';
import { ownerIdForWorld } from '../db/ownership.js';
import { buildContextPackage } from '../services/archivist.js';
import { recordArticleIssues } from '../services/issueRecorder.js';
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

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class LinterAgent extends BaseAgent<LinterInput, LinterOutput> {
  readonly agentType = 'linter';
  readonly mode = 'check';
  readonly outputToolName = 'submit_lint_report';

  protected getMaxTokens(): number { return 1000; }

  protected getContextTools(): Tool[] {
    return CONTEXT_TOOLS;
  }

  protected async buildMessages(worldId: string, input: LinterInput): Promise<ChatMessage[]> {
    let contextPackage;
    try {
      contextPackage = await buildContextPackage(worldId, input.articleId, { contextDepth: 'mid' });
    } catch {
      return [
        { role: 'system', content: buildLinterSystemPrompt(input.worldContext) },
        { role: 'user', content: 'Article not found.' },
      ];
    }

    return [
      { role: 'system', content: buildLinterSystemPrompt(input.worldContext) },
      {
        role: 'user',
        content: buildLinterUserMessage(
          contextPackage.targetTitle,
          contextPackage.targetDescription,
          {
            parents: contextPackage.parents.map((p) => ({ title: p.title, summary: p.summary })),
            siblings: contextPackage.siblings.map((s) => ({ title: s.title, summary: s.summary })),
            fixedPoints: contextPackage.fixedPoints.map((f) => ({ title: f.title, summary: f.summary })),
          },
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
    const exec = getDbClient();
    const result = await this.run(worldId, { worldId, articleId, worldContext });
    const ownerId = await ownerIdForWorld(exec, worldId);

    await recordArticleIssues(exec, {
      worldId,
      ownerId,
      articleId,
      source: 'linter',
      issues: result.output.issues.map((issue) => ({
        severity: issue.severity,
        code: 'SEMANTIC_ISSUE',
        excerpt: issue.excerpt,
        explanation: issue.explanation,
        suggestion: issue.suggestion,
      })),
    });
  }
}
