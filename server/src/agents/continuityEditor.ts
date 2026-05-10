import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildContinuityEditorSystemPrompt, buildContinuityEditorUserMessage } from '../prompts/continuityEditor.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ResearchBrief } from './scribe.js';
import { CONTEXT_TOOLS } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const ContradictionSchema = z.object({
  excerpt:    z.string(),
  issue:      z.string(),
  correction: z.string(),
});

const SubmitContinuityCheckSchema = z.object({
  approved:       z.boolean(),
  contradictions: z.array(ContradictionSchema).default([]),
});

export interface Contradiction {
  excerpt:    string;
  issue:      string;
  correction: string;
}

export interface ContinuityEditorOutput {
  approved:       boolean;
  contradictions: Contradiction[];
}

export interface ContinuityEditorInput {
  contextPackage: ContextPackage;
  worldContext:   WorldContext;
  draft:          string;
  researchBrief:  ResearchBrief;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ContinuityEditorAgent extends BaseAgent<ContinuityEditorInput, ContinuityEditorOutput> {
  readonly agentType = 'continuity_editor';
  readonly outputToolName = 'submit_continuity_check';

  protected getMaxTokens(): number { return 1000; }

  protected getContextTools(): Tool[] {
    return CONTEXT_TOOLS;
  }

  protected buildMessages(_worldId: string, input: ContinuityEditorInput): ChatMessage[] {
    return [
      { role: 'system', content: buildContinuityEditorSystemPrompt(input.worldContext) },
      {
        role: 'user',
        content: buildContinuityEditorUserMessage(
          input.contextPackage,
          input.draft,
          input.researchBrief,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_continuity_check;
  }

  protected parseOutput(input: Record<string, unknown>): ContinuityEditorOutput {
    const parsed = SubmitContinuityCheckSchema.parse(input);
    return {
      approved:       parsed.approved,
      contradictions: parsed.contradictions,
    };
  }
}
