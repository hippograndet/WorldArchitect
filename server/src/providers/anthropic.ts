import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, CompletionOptions, CompletionResult, LLMProvider } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? DEFAULT_MODEL;
  }

  async complete(messages: ChatMessage[], options?: CompletionOptions): Promise<CompletionResult> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: conversation,
    });

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

    return {
      content,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    };
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
