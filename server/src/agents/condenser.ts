import { z } from 'zod';
import { BaseAgent } from './base.js';
import { OUTPUT_TOOLS } from '../tools/output.js';
import {
  buildBibleCompressorSystemPrompt,
  buildBibleCompressorUserMessage,
  type CompressorEntry,
} from '../prompts/bibleCompressor.js';
import type { WorldContext } from './director.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool } from '../tools/types.js';

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

const CompressionEntrySchema = z.object({
  articleId: z.string(),
  compressedSummary: z.string(),
  tokensBefore: z.number(),
  tokensAfter: z.number(),
});

const SubmitCompressionSchema = z.object({
  entries: z.array(CompressionEntrySchema),
});

export type CompressionEntry = z.infer<typeof CompressionEntrySchema>;
export type CondenserOutput = { entries: CompressionEntry[] };

export interface CondenserInput {
  worldContext: WorldContext;
  entries: CompressorEntry[];
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class CondenserAgent extends BaseAgent<CondenserInput, CondenserOutput> {
  readonly agentType = 'condenser';
  readonly mode = 'write';
  readonly outputToolName = 'submit_compression';

  protected buildMessages(_worldId: string, input: CondenserInput): ChatMessage[] {
    return [
      {
        role: 'system',
        content: buildBibleCompressorSystemPrompt(input.worldContext),
      },
      {
        role: 'user',
        content: buildBibleCompressorUserMessage(input.entries),
      },
    ];
  }

  protected buildOutputTool(): Tool {
    return OUTPUT_TOOLS.submit_compression;
  }

  protected getContextTools(): Tool[] {
    return [];
  }

  protected parseOutput(input: Record<string, unknown>): CondenserOutput {
    const parsed = SubmitCompressionSchema.parse(input);
    return { entries: parsed.entries };
  }
}
