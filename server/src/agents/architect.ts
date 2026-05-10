import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildSkeletonSystemPrompt, buildSkeletonUserPrompt } from '../prompts/skeleton.js';
import type { WorldContext } from './director.js';
import { LOOKUP_NAMES_TOOL } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const StubSchema = z.object({
  categoryName: z.string(),
  title: z.string(),
  summary: z.string(),
  templateType: z.enum(['general', 'character', 'location', 'faction']),
});

const SubmitStubsSchema = z.object({
  stubs: z.array(StubSchema),
});

export type Stub = z.infer<typeof StubSchema>;
export type ArchitectOutput = { stubs: Stub[] };

export interface ArchitectInput {
  seedText: string;
  categories: Array<{ id: string; name: string }>;
  worldContext?: WorldContext;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ArchitectAgent extends BaseAgent<ArchitectInput, ArchitectOutput> {
  readonly agentType = 'architect';
  readonly outputToolName = 'submit_stubs';

  protected buildMessages(_worldId: string, input: ArchitectInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildSkeletonSystemPrompt(input.categories.map((c) => c.name), input.worldContext),
      },
      {
        role: 'user',
        content: buildSkeletonUserPrompt(input.seedText),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_stubs;
  }

  protected getContextTools(): Tool[] {
    return [LOOKUP_NAMES_TOOL];
  }

  protected parseOutput(input: Record<string, unknown>): ArchitectOutput {
    const parsed = SubmitStubsSchema.parse(input);
    return { stubs: parsed.stubs };
  }
}
