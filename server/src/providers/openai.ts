import OpenAI from 'openai';
import type { ChatMessage, CompletionOptions, CompletionResult, LLMProvider, ProviderName } from './types.js';

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

  async complete(messages: ChatMessage[], options?: CompletionOptions): Promise<CompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      // json_object mode is supported by OpenAI and Groq; skip for Ollama (varies by model)
      ...(options?.jsonMode && this.name !== 'ollama'
        ? { response_format: { type: 'json_object' as const } }
        : {}),
    });

    return {
      content: response.choices[0]?.message?.content ?? '',
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    };
  }

  async estimateTokens(text: string): Promise<number> {
    // No free token-counting endpoint for OpenAI-compatible APIs.
    // ~4 chars per token is a reasonable approximation for English prose.
    return Math.ceil(text.length / 4);
  }
}
