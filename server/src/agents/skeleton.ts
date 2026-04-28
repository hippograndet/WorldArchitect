import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import { buildSkeletonSystemPrompt, buildSkeletonUserPrompt } from '../prompts/skeleton.js';
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
export type SkeletonOutput = { stubs: Stub[] };

export interface SkeletonInput {
  seedText: string;
  categories: Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class SkeletonAgent extends BaseAgent<SkeletonInput, SkeletonOutput> {
  readonly agentType = 'skeleton';
  readonly outputToolName = 'submit_stubs';

  protected buildMessages(_worldId: string, input: SkeletonInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildSkeletonSystemPrompt(input.categories.map((c) => c.name)),
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

  // SkeletonAgent works only from the world description — no DB context needed.
  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): SkeletonOutput {
    const parsed = SubmitStubsSchema.parse(input);
    return { stubs: parsed.stubs };
  }
}
