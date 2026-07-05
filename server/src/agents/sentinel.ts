import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildRetentionSystemPrompt, buildRetentionUserMessage } from '../prompts/retention.js';
import type { WorldContext } from './director.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const RetentionIssueSchema = z.object({
  description: z.string(),
  severity: z.enum(['warning', 'critical']),
});

const SubmitRetentionCheckSchema = z.object({
  passed: z.boolean(),
  issues: z.array(RetentionIssueSchema),
});

export type RetentionIssue = z.infer<typeof RetentionIssueSchema>;
export type SentinelOutput = { passed: boolean; issues: RetentionIssue[] };

export interface SentinelInput {
  articleTitle: string;
  originalBody: string;
  reorganizedDescription: string;
  worldContext: WorldContext;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class SentinelAgent extends BaseAgent<SentinelInput, SentinelOutput> {
  readonly agentType = 'sentinel';
  readonly mode = 'check';
  readonly outputToolName = 'submit_retention_check';

  protected buildMessages(_worldId: string, input: SentinelInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildRetentionSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildRetentionUserMessage(
          input.articleTitle,
          input.originalBody,
          input.reorganizedDescription,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_retention_check;
  }

  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): SentinelOutput {
    const parsed = SubmitRetentionCheckSchema.parse(input);
    return { passed: parsed.passed, issues: parsed.issues };
  }
}
