import { getProvider } from '../providers/index.js';
import { logCall } from '../services/callLogger.js';
import { executeContextTool, CONTEXT_TOOLS } from '../tools/context.js';
import type { ChatMessage } from '../providers/types.js';
import type { Tool, ToolCall } from '../tools/types.js';

// ---------------------------------------------------------------------------
// tool_use_failed recovery
// ---------------------------------------------------------------------------

function tryRecoverToolUseFailed(err: unknown): Record<string, unknown> | null {
  if (typeof err !== 'object' || err === null) return null;
  if ((err as { code?: unknown }).code !== 'tool_use_failed') return null;
  const gen = ((err as { error?: { failed_generation?: unknown } }).error)?.failed_generation;
  if (typeof gen !== 'string') return null;

  const braceIdx = gen.search(/[{[]/);
  if (braceIdx === -1) return null;
  // Replace literal newlines (invalid inside JSON strings) with a space, then parse
  const jsonStr = gen.slice(braceIdx).replace(/<\/function>\s*$/, '').trim().replace(/\n/g, ' ').replace(/\r/g, '');

  try {
    const parsed: unknown = JSON.parse(jsonStr);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const MAX_ITERATIONS = 10;

export interface AgentResult<TOutput> {
  output: TOutput;
  tokensIn: number;
  tokensOut: number;
}

/**
 * BaseAgent implements the tool-use loop shared by all agents.
 *
 * Subclasses provide:
 *   - agentType / outputToolName — identity
 *   - buildMessages()   — initial conversation
 *   - buildOutputTool() — the single output tool definition
 *   - parseOutput()     — Zod-validate the output tool's input
 *   - getContextTools() — optional override (defaults to all context tools)
 */
export abstract class BaseAgent<TInput, TOutput> {
  abstract readonly agentType: string;
  abstract readonly outputToolName: string;

  protected abstract buildMessages(worldId: string, input: TInput): ChatMessage[] | Promise<ChatMessage[]>;
  protected abstract buildOutputTool(): Tool;
  protected abstract parseOutput(input: Record<string, unknown>): TOutput;

  /** Override to restrict or remove context tools available to this agent. */
  protected getContextTools(): Tool[] {
    return CONTEXT_TOOLS;
  }

  /** Override in subclasses that generate long prose (e.g. ScribeAgent). */
  protected getMaxTokens(): number { return 1024; }

  /** Override in agents that only ever call the output tool once (e.g. Curator, Sentinel). */
  protected getMaxIterations(): number { return MAX_ITERATIONS; }

  /** Override to return undefined in agents that may produce free-text responses. */
  protected getToolChoice(): 'required' | undefined { return 'required'; }

  async run(worldId: string, input: TInput): Promise<AgentResult<TOutput>> {
    const provider = await getProvider();
    const messages: ChatMessage[] = await this.buildMessages(worldId, input);
    const tools: Tool[] = [...this.getContextTools(), this.buildOutputTool()];

    let tokensIn = 0;
    let tokensOut = 0;
    let status: 'success' | 'error' = 'error';
    let output: TOutput | null = null;

    try {
      for (let iter = 0; iter < this.getMaxIterations(); iter++) {
        const toolChoice = this.getToolChoice();
        let result;
        try {
          result = await provider.complete(
            messages,
            { maxTokens: this.getMaxTokens(), ...(toolChoice ? { toolChoice } : {}) },
            tools,
          );
        } catch (providerErr: unknown) {
          const recovered = tryRecoverToolUseFailed(providerErr);
          if (recovered !== null) {
            try { output = this.parseOutput(recovered); status = 'success'; } catch { /* fall through */ }
          }
          if (output === null) throw providerErr;
          break;
        }
        tokensIn += result.tokensIn;
        tokensOut += result.tokensOut;

        if (result.stopReason !== 'tool_use' || !result.toolCalls?.length) break;

        // Append the assistant turn with its tool calls
        messages.push({
          role: 'assistant',
          content: result.content,
          toolCalls: result.toolCalls,
        });

        // Process each tool call
        for (const call of result.toolCalls) {
          if (call.name === this.outputToolName) {
            try {
              output = this.parseOutput(call.input);
              messages.push({ role: 'tool', content: 'accepted', toolCallId: call.id });
            } catch (parseErr) {
              // Feed validation error back so the LLM can self-correct in the next iteration
              const msg = parseErr instanceof Error ? parseErr.message : 'Validation failed';
              messages.push({ role: 'tool', content: `Tool call rejected: ${msg}. Please revise and call the tool again.`, toolCallId: call.id });
            }
          } else {
            const content = await executeContextTool(worldId, call);
            messages.push({ role: 'tool', content, toolCallId: call.id });
          }
        }

        if (output !== null) {
          status = 'success';
          break;
        }
      }
    } finally {
      try {
        await logCall({ worldId, agentType: this.agentType, tokensIn, tokensOut, status });
      } catch { /* logging must never crash the agent */ }
    }

    if (output === null) {
      throw new Error(
        `Agent "${this.agentType}" did not produce output within ${this.getMaxIterations()} iterations`,
      );
    }

    return { output, tokensIn, tokensOut };
  }

  /** Convenience for subclasses that need to call a context tool manually. */
  protected async callContextTool(worldId: string, call: ToolCall): Promise<string> {
    return executeContextTool(worldId, call);
  }
}
