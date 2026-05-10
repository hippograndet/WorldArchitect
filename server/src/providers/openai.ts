import OpenAI from 'openai';
import type { ChatMessage, CompletionOptions, CompletionResult, LLMProvider, ProviderName } from './types.js';
import type { Tool, ToolCall } from '../tools/types.js';

const DEFAULTS: Record<string, string> = {
  openai: 'gpt-4o',
  groq: 'llama-3.3-70b-versatile',
  ollama: 'llama3',
};

const BASE_URLS: Partial<Record<ProviderName, string>> = {
  groq: 'https://api.groq.com/openai/v1',
  ollama: 'http://localhost:11434/v1',
};

/**
 * Single adapter for all OpenAI-compatible providers (OpenAI, Groq, Ollama).
 * Groq and Ollama expose an OpenAI-compatible /v1 API so the same client
 * works by swapping baseURL and apiKey.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: ProviderName;
  private client: OpenAI;
  private model: string;

  constructor(name: ProviderName, apiKey: string, baseURL?: string, model?: string) {
    this.name = name;
    this.model = model ?? DEFAULTS[name] ?? 'gpt-4o';

    const resolvedBase = baseURL ?? BASE_URLS[name];
    this.client = new OpenAI({
      apiKey,
      ...(resolvedBase ? { baseURL: resolvedBase } : {}),
    });
  }

  async complete(messages: ChatMessage[], options?: CompletionOptions, tools?: Tool[]): Promise<CompletionResult> {
    const openAIMessages = this.buildApiMessages(messages);

    const openAITools = tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature,
      messages: openAIMessages,
      ...(openAITools?.length ? { tools: openAITools } : {}),
      ...(openAITools?.length && options?.toolChoice === 'required' ? { tool_choice: 'required' as const } : {}),
      // json_object mode is supported by OpenAI and Groq; skip for Ollama (varies by model)
      ...(options?.jsonMode && this.name !== 'ollama' && !openAITools?.length
        ? { response_format: { type: 'json_object' as const } }
        : {}),
    });

    const choice = response.choices[0];
    const rawToolCalls = choice.message.tool_calls;
    const toolCalls: ToolCall[] | undefined = rawToolCalls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    const finishReason = choice.finish_reason;
    const stopReason: CompletionResult['stopReason'] =
      finishReason === 'tool_calls' ? 'tool_use' :
      finishReason === 'length' ? 'max_tokens' : 'end_turn';

    return {
      content: choice.message.content ?? '',
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      stopReason,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
    };
  }

  private buildApiMessages(messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: m.toolCallId!,
          content: m.content,
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      };
    });
  }

  async estimateTokens(text: string): Promise<number> {
    // No free token-counting endpoint for OpenAI-compatible APIs.
    return Math.ceil(text.length / 4);
  }
}
