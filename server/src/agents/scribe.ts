import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildExpanderSystemPrompt,
  buildExpanderUserMessage,
  type ExpanderMode,
} from '../prompts/expander.js';
import type { WorldContext } from './director.js';
import type { ContextPackage } from '../services/archivist.js';
import type { ProposalItem } from './muse.js';
import type { IdeaItem } from './oracle.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const SubmitDescriptionSchema = z.object({
  description: z.string(),
});

const SubmitChildDescriptionSchema = z.object({
  childDescription: z.string(),
  parentAppend: z.string(),
});

export type ScribeOutput =
  | { mode: 'single'; description: string }
  | { mode: 'child'; childDescription: string; parentAppend: string };

export interface ScribeInput {
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  mode: ExpanderMode;
  selectedProposal?: ProposalItem;
  selectedIdeas?: IdeaItem[];
  userSpec?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ScribeAgent extends BaseAgent<ScribeInput, ScribeOutput> {
  readonly agentType = 'scribe';

  get outputToolName(): string {
    return this._mode === 'create_child' ? 'submit_child_description' : 'submit_description';
  }

  private _mode: ExpanderMode = 'expand_description';

  protected getMaxTokens(): number { return 8192; }

  protected buildMessages(_worldId: string, input: ScribeInput): ChatMessage[] {
    this._mode = input.mode;
    return [
      {
        role: 'system',
        content: buildExpanderSystemPrompt(input.worldContext, input.mode),
      },
      {
        role: 'user',
        content: buildExpanderUserMessage(
          input.contextPackage,
          input.mode,
          input.selectedProposal,
          input.userSpec,
          input.selectedIdeas,
        ),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return this._mode === 'create_child'
      ? OUTPUT_TOOLS.submit_child_description
      : OUTPUT_TOOLS.submit_description;
  }

  protected parseOutput(input: Record<string, unknown>): ScribeOutput {
    if (this._mode === 'create_child') {
      const parsed = SubmitChildDescriptionSchema.parse(input);
      return { mode: 'child', childDescription: parsed.childDescription, parentAppend: parsed.parentAppend };
    }
    const parsed = SubmitDescriptionSchema.parse(input);
    return { mode: 'single', description: parsed.description };
  }
}
