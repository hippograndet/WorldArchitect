import Anthropic from '@anthropic-ai/sdk';
import { redactSecrets } from '../security/redaction.js';
import type { ChatMessage, CompletionOptions, CompletionResult, LLMProvider } from './types.js';
import type { Tool, ToolCall } from '../tools/types.js';
import { assertTokenBudget, runProviderRequest } from './safety.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? DEFAULT_MODEL;
  }

  async complete(messages: ChatMessage[], options?: CompletionOptions, tools?: Tool[]): Promise<CompletionResult> {
    assertTokenBudget(messages, options);
    const systemMsg = messages.find((m) => m.role === 'system');
    const apiMessages = this.buildApiMessages(messages.filter((m) => m.role !== 'system'));

    const anthropicTools = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }));

    let response: Awaited<ReturnType<typeof this.client.messages.create>>;
    try {
      response = await runProviderRequest(
        () => this.client.messages.create({
          model: this.model,
          max_tokens: options?.maxTokens ?? 4096,
          ...(systemMsg ? { system: systemMsg.content } : {}),
          messages: apiMessages,
          ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
          ...(anthropicTools?.length && options?.toolChoice === 'required' ? { tool_choice: { type: 'any' as const } } : {}),
        }),
        options,
      );
    } catch (err) {
      // Surface failed_generation from Anthropic 400 tool-call errors
      const raw = err as Record<string, unknown>;
      const body = (raw?.error ?? raw?.body) as Record<string, unknown> | undefined;
      const failedGen = (body?.failed_generation ?? (body?.error as Record<string, unknown> | undefined)?.failed_generation) as string | undefined;
      if (failedGen) {
        throw new Error(`${redactSecrets((err as Error).message)}\n\nFailed generation (truncated):\n${redactSecrets(failedGen.slice(0, 500))}`);
      }
      throw err;
    }

    const content = response.content.find((b) => b.type === 'text')
      ? (response.content.find((b) => b.type === 'text') as Anthropic.TextBlock).text
      : '';

    const toolCalls: ToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));

    const stopReason: CompletionResult['stopReason'] =
      response.stop_reason === 'tool_use' ? 'tool_use' :
      response.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn';

    return {
      content,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      stopReason,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }

  private buildApiMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];

      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.toolCalls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
        result.push({ role: 'assistant', content });
        i++;
        continue;
      }

      if (msg.role === 'tool') {
        // Bundle consecutive tool results into a single user message
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        while (i < messages.length && messages[i].role === 'tool') {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: messages[i].toolCallId!,
            content: messages[i].content,
          });
          i++;
        }
        result.push({ role: 'user', content: toolResults });
        continue;
      }

      result.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      i++;
    }

    return result;
  }

  async estimateTokens(text: string): Promise<number> {
    try {
      const result = await this.client.messages.countTokens({
        model: this.model,
        messages: [{ role: 'user', content: text }],
      });
      return result.input_tokens;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
}
