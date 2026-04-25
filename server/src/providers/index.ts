import { getDb } from '../db/index.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai.js';
import type { LLMProvider, ProviderConfig, ProviderName } from './types.js';

export type { LLMProvider, ProviderName, ProviderConfig };

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

interface RawSettings {
  provider: string;
  config: string;
}

export function readProviderSettings(): { provider: ProviderName | 'none'; config: ProviderConfig } {
  const row = getDb()
    .prepare("SELECT provider, config FROM provider_settings WHERE id = 'singleton'")
    .get() as RawSettings | undefined;

  return {
    provider: (row?.provider ?? 'none') as ProviderName | 'none',
    config: row?.config ? (JSON.parse(row.config) as ProviderConfig) : {},
  };
}

export function writeProviderSettings(
  provider: ProviderName | 'none',
  config: ProviderConfig,
): void {
  getDb()
    .prepare(`
      UPDATE provider_settings
      SET provider = ?, config = ?, updated_at = ?
      WHERE id = 'singleton'
    `)
    .run(provider, JSON.stringify(config), Date.now());
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

export function isLLMConfigured(): boolean {
  const { provider } = readProviderSettings();
  return provider !== 'none';
}

/**
 * Build and return the active LLMProvider.
 * Throws with a user-friendly message when nothing is configured.
 */
export function getProvider(): LLMProvider {
  const { provider, config } = readProviderSettings();

  switch (provider) {
    case 'anthropic': {
      if (!config.anthropicKey) throw new Error('Anthropic API key not set');
      return new AnthropicProvider(config.anthropicKey, config.anthropicModel);
    }
    case 'openai': {
      if (!config.openaiKey) throw new Error('OpenAI API key not set');
      return new OpenAICompatibleProvider('openai', config.openaiKey, undefined, config.openaiModel);
    }
    case 'groq': {
      if (!config.groqKey) throw new Error('Groq API key not set');
      return new OpenAICompatibleProvider('groq', config.groqKey, undefined, config.groqModel);
    }
    case 'ollama': {
      return new OpenAICompatibleProvider(
        'ollama',
        'ollama',                              // Ollama ignores the key
        config.ollamaUrl ?? 'http://localhost:11434/v1',
        config.ollamaModel ?? 'llama3',
      );
    }
    default:
      throw new Error('No LLM provider configured. Go to Settings to add an API key.');
  }
}

/**
 * Express middleware — returns 503 when no LLM is configured.
 * Apply to all agent routes so manual features remain unaffected.
 */
export function requireLLM(
  _req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  if (!isLLMConfigured()) {
    res.status(503).json({
      error: 'No LLM provider configured.',
      hint: 'All manual editing features work without an LLM. Go to Settings to add an API key.',
    });
    return;
  }
  next();
}

/** Mask an API key for safe client display: `sk-ant-api03-xxxx...yyyy` → `sk-ant-****yyyy` */
export function maskKey(key: string | undefined): string | undefined {
  if (!key || key.length < 8) return undefined;
  return `${key.slice(0, 6)}****${key.slice(-4)}`;
}
