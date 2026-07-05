import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildStyleWardenSystemPrompt, buildStyleWardenUserMessage } from '../prompts/styleWarden.js';
import type { WorldContext } from './director.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const StyleIssueSchema = z.object({
  severity: z.enum(['suggestion', 'warning']),
  category: z.enum(['clarity', 'tone', 'logic', 'consistency']),
  description: z.string(),
  excerpt: z.string().optional(),
});

const SubmitStyleCheckSchema = z.object({
  issues: z.array(StyleIssueSchema),
  overallToneMatch: z.enum(['excellent', 'good', 'off']),
  summary: z.string(),
});

export type StyleIssue = z.infer<typeof StyleIssueSchema>;
export type StyleWardenOutput = z.infer<typeof SubmitStyleCheckSchema>;

export interface StyleWardenInput {
  articleTitle: string;
  content: string;
  contentLabel: 'Description' | 'Chronology' | 'Introduction';
  worldContext: WorldContext;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class StyleWardenAgent extends BaseAgent<StyleWardenInput, StyleWardenOutput> {
  readonly agentType = 'style_warden';
  readonly mode = 'check';
  readonly outputToolName = 'submit_style_check';

  protected buildMessages(_worldId: string, input: StyleWardenInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildStyleWardenSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildStyleWardenUserMessage(
          input.articleTitle,
          input.content,
          input.contentLabel,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_style_check;
  }

  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): StyleWardenOutput {
    return SubmitStyleCheckSchema.parse(input);
  }
}
