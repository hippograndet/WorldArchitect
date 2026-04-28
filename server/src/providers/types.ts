import type { Tool, ToolCall } from '../tools/types.js';

export type { Tool, ToolCall };

export type ProviderName = 'anthropic' | 'openai' | 'groq' | 'ollama';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool calls made by the assistant (present on role='assistant' messages with tool use) */
  toolCalls?: ToolCall[];
  /** ID of the tool call this result responds to (present on role='tool' messages) */
  toolCallId?: string;
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
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  name: ProviderName;
  complete(messages: ChatMessage[], options?: CompletionOptions, tools?: Tool[]): Promise<CompletionResult>;
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
