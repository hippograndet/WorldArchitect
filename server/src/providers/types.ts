export type ProviderName = 'anthropic' | 'openai' | 'groq' | 'ollama';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  /** Hint to enforce JSON output where the provider supports it natively */
  jsonMode?: boolean;
}

export interface CompletionResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
}

export interface LLMProvider {
  name: ProviderName;
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<CompletionResult>;
  /** Returns real token count when the provider has an API for it, otherwise approximates */
  estimateTokens(text: string): Promise<number>;
}

export interface ProviderConfig {
  anthropicKey?: string;
  anthropicModel?: string;
  openaiKey?: string;
  openaiModel?: string;
  groqKey?: string;
  groqModel?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
}
