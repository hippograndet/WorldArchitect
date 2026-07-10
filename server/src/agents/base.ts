import { getProvider } from '../providers/index.js';
import { logCall } from '../services/callLogger.js';
import { logLlmTrace } from '../services/llmTraceService.js';
import { executeContextTool, CONTEXT_TOOLS } from '../tools/context.js';
import { redactErrorMessage } from '../security/redaction.js';
import type { ChatMessage, CompletionOptions, CompletionResult } from '../providers/types.js';
import type { Tool, ToolCall } from '../tools/types.js';
import type { ArticleDependencyReference, ProposedArticleMetadataChange } from '../types/articleSemantics.js';

// ---------------------------------------------------------------------------
// tool_use_failed recovery
// ---------------------------------------------------------------------------

function tryRecoverToolUseFailed(err: unknown): Record<string, unknown> | null {
  const gen = getToolUseFailedGeneration(err);
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

function getToolUseFailedGeneration(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const direct = err as { code?: unknown; failed_generation?: unknown; error?: unknown };
  const nested = typeof direct.error === 'object' && direct.error !== null
    ? direct.error as { code?: unknown; failed_generation?: unknown }
    : null;
  const code = direct.code ?? nested?.code;
  const gen = direct.failed_generation ?? nested?.failed_generation;
  if (code === 'tool_use_failed' && typeof gen === 'string') return gen;

  const cause = (direct as { cause?: unknown }).cause;
  return cause ? getToolUseFailedGeneration(cause) : null;
}

function providerErrorMessage(err: unknown): string {
  const message = redactErrorMessage(err);
  const failedGeneration = getToolUseFailedGeneration(err);
  if (!failedGeneration) return message;
  const compact = failedGeneration.replace(/\s+/g, ' ').slice(0, 500);
  return `${message} failed_generation: ${compact}`;
}

const MAX_ITERATIONS = 10;

/**
 * Optional, structured data an agent may leave alongside its main output —
 * dependencies it noticed, metadata changes it wants to propose, coherence
 * warnings, or issues. Reuses the same forward-compatible types context
 * assembly already tags items with (`types/articleSemantics.ts`), so an agent
 * that starts actually proposing e.g. metadata changes has a channel ready
 * with no new shape to invent.
 */
export interface AgentSideChannel {
  proposedDependencies?: ArticleDependencyReference[];
  proposedMetadataChanges?: ProposedArticleMetadataChange[];
  coherenceWarnings?: Array<{ severity: string; description: string; involvedArticleIds?: string[] }>;
  issues?: Array<{ severity: string; code?: string; excerpt?: string; explanation: string; suggestion?: string }>;
}

export interface AgentResult<TOutput> {
  output: TOutput;
  sideChannel?: AgentSideChannel;
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
  /** 'write' agents produce/alter prose; 'check' agents only produce judgments and never alter article content. */
  abstract readonly mode: 'write' | 'check';

  protected abstract buildMessages(worldId: string, input: TInput): ChatMessage[] | Promise<ChatMessage[]>;
  protected abstract buildOutputTool(): Tool;
  protected abstract parseOutput(input: Record<string, unknown>): TOutput;

  /** Override to restrict or remove context tools available to this agent. */
  protected getContextTools(): Tool[] {
    return CONTEXT_TOOLS;
  }

  /** Override in subclasses that generate long prose (e.g. ScribeAgent). */
  protected getMaxTokens(): number { return 1024; }

  /** Override when a specific agent needs provider safety settings. */
  protected getCompletionOptions(): CompletionOptions { return {}; }

  /** Override in agents that only ever call the output tool once (e.g. Curator, Sentinel). */
  protected getMaxIterations(): number { return MAX_ITERATIONS; }

  /** Override to return undefined in agents that may produce free-text responses. */
  protected getToolChoice(): 'required' | undefined { return 'required'; }

  /** Override for long-form prose agents that should finish from assistant text. */
  protected getOutputMode(): 'tool' | 'text' { return 'tool'; }

  /** Override when getOutputMode() returns 'text'. */
  protected parseTextOutput(content: string): TOutput {
    return this.parseOutput({ content });
  }

  async run(
    worldId: string,
    input: TInput,
    callCtx?: { pipelineRunId?: string; pipelineType?: string; articleId?: string },
  ): Promise<AgentResult<TOutput>> {
    const provider = await getProvider();
    const messages: ChatMessage[] = await this.buildMessages(worldId, input);
    const outputMode = this.getOutputMode();
    const contextTools = this.getContextTools();
    const tools: Tool[] = outputMode === 'tool'
      ? [...contextTools, this.buildOutputTool()]
      : contextTools;

    let tokensIn = 0;
    let tokensOut = 0;
    let status: 'success' | 'error' = 'error';
    let output: TOutput | null = null;
    let iterations = 0;
    let lastOutputRejection: string | undefined;
    let stoppedWithoutToolUse: CompletionResult['stopReason'] | undefined;
    let errorMessage: string | undefined;

    try {
      for (let iter = 0; iter < this.getMaxIterations(); iter++) {
        iterations++;
        const toolChoice = outputMode === 'tool' ? this.getToolChoice() : undefined;
        const completionOptions = this.getCompletionOptions();
        const requestOptions = { maxTokens: this.getMaxTokens(), ...completionOptions, ...(toolChoice ? { toolChoice } : {}) };
        let result;
        try {
          result = await provider.complete(
            messages,
            requestOptions,
            tools,
          );
        } catch (providerErr: unknown) {
          errorMessage = providerErrorMessage(providerErr);
          await logLlmTrace({
            worldId,
            agentType: this.agentType,
            articleId: callCtx?.articleId,
            runId: callCtx?.pipelineRunId,
            provider: provider.name,
            iteration: iterations,
            status: 'error',
            messages,
            options: requestOptions,
            tools,
            errorMessage,
          });
          const recovered = tryRecoverToolUseFailed(providerErr);
          if (recovered !== null) {
            try { output = this.parseOutput(recovered); status = 'success'; } catch { /* fall through */ }
          }
          if (output === null) throw providerErr;
          break;
        }
        await logLlmTrace({
          worldId,
          agentType: this.agentType,
          articleId: callCtx?.articleId,
          runId: callCtx?.pipelineRunId,
          provider: provider.name,
          iteration: iterations,
          status: 'success',
          messages,
          options: requestOptions,
          tools,
          response: result,
        });
        tokensIn += result.tokensIn;
        tokensOut += result.tokensOut;

        if (outputMode === 'text' && result.stopReason !== 'tool_use') {
          try {
            output = this.parseTextOutput(result.content);
            status = 'success';
            break;
          } catch (parseErr) {
            const msg = parseErr instanceof Error ? parseErr.message : 'Validation failed';
            lastOutputRejection = msg;
            break;
          }
        }

        if (result.stopReason !== 'tool_use' || !result.toolCalls?.length) {
          stoppedWithoutToolUse = result.stopReason ?? 'end_turn';
          break;
        }

        // Append the assistant turn with its tool calls
        messages.push({
          role: 'assistant',
          content: result.content,
          toolCalls: result.toolCalls,
        });

        // Process each tool call
        for (const call of result.toolCalls) {
          if (outputMode === 'tool' && call.name === this.outputToolName) {
            try {
              output = this.parseOutput(call.input);
              messages.push({ role: 'tool', content: 'accepted', toolCallId: call.id });
            } catch (parseErr) {
              // Feed validation error back so the LLM can self-correct in the next iteration
              const msg = parseErr instanceof Error ? parseErr.message : 'Validation failed';
              lastOutputRejection = msg;
              messages.push({ role: 'tool', content: `Tool call rejected: ${msg}. Please revise and call the tool again.`, toolCallId: call.id });
            }
          } else if (contextTools.some((tool) => tool.name === call.name)) {
            const content = await executeContextTool(worldId, call);
            messages.push({ role: 'tool', content, toolCallId: call.id });
          } else {
            messages.push({ role: 'tool', content: `Tool call rejected: ${call.name} is not available.`, toolCallId: call.id });
          }
        }

        if (output !== null) {
          status = 'success';
          break;
        }
      }
    } finally {
      try {
        await logCall({
          worldId,
          agentType: this.agentType,
          tokensIn,
          tokensOut,
          status,
          errorMessage,
          iterations,
          pipelineRunId: callCtx?.pipelineRunId,
          pipelineType: callCtx?.pipelineType,
          articleId: callCtx?.articleId,
        });
      } catch { /* logging must never crash the agent */ }
    }

    if (output === null) {
      const attempts = `${iterations} attempt${iterations === 1 ? '' : 's'}`;
      const detail = lastOutputRejection
        ? ` Last rejection: ${lastOutputRejection}`
        : stoppedWithoutToolUse
          ? ` Last stop reason: ${stoppedWithoutToolUse}.`
          : '';
      const hasContextTools = this.getContextTools().length > 0;
      const message = outputMode === 'text'
        ? `Agent "${this.agentType}" did not produce valid text output after ${attempts}.${detail}`
        : hasContextTools
        ? `Agent "${this.agentType}" did not produce output within ${this.getMaxIterations()} iterations.${detail}`
        : `Agent "${this.agentType}" did not call ${this.outputToolName} with valid output after ${attempts}.${detail}`;
      throw new Error(message);
    }

    return { output, tokensIn, tokensOut };
  }

  /** Convenience for subclasses that need to call a context tool manually. */
  protected async callContextTool(worldId: string, call: ToolCall): Promise<string> {
    return executeContextTool(worldId, call);
  }
}
