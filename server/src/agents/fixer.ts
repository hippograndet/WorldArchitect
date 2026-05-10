import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import type { WorldContext } from './director.js';
import { buildWorldHeader } from '../prompts/shared.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitFixSchema = z.object({
  rewritten_passage: z.string(),
});

export interface FixerOutput {
  rewrittenPassage: string;
}

export interface FixerInput {
  articleTitle: string;
  articleBody:  string;
  worldContext: WorldContext;
  excerpt:     string;
  explanation: string;
  suggestion:  string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class FixerAgent extends BaseAgent<FixerInput, FixerOutput> {
  readonly agentType = 'fixer';
  readonly outputToolName = 'submit_fix';

  protected getMaxTokens(): number { return 2048; }

  protected buildMessages(_worldId: string, input: FixerInput): ChatMessage[] {
    const systemPrompt = `You are the Fixer for WorldArchitect, a fiction world-building tool.

${buildWorldHeader(input.worldContext)}

You receive an article with a specific identified issue. Your job is to rewrite ONLY the offending excerpt to resolve the issue — do not rewrite the full article, do not change anything outside the excerpt.

Preserve tone, style, and all other content. Call submit_fix with only the rewritten passage.`;

    const userContent = `## Article: ${input.articleTitle}

## Full Description
${input.articleBody}

## Issue to Fix
**Offending excerpt:** "${input.excerpt}"
**Problem:** ${input.explanation}
**Suggested fix:** ${input.suggestion}

Rewrite only the offending excerpt to resolve this issue. Call submit_fix.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_fix;
  }

  protected parseOutput(input: Record<string, unknown>): FixerOutput {
    const parsed = SubmitFixSchema.parse(input);
    return { rewrittenPassage: parsed.rewritten_passage };
  }
}
