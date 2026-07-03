import { getDbClient } from '../db/client.js';
import { getAppMode, LOCAL_USER_ID } from '../config.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getContextUserId } from '../requestContext.js';
import { maskSecret } from '../security/redaction.js';
import { decryptSecret, encryptSecret } from '../security/secrets.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai.js';
import { ProviderSafetyError } from './safety.js';
import type { ConfigSource, LLMProvider, ProviderConfig, ProviderName } from './types.js';

export type { LLMProvider, ProviderName, ProviderConfig };

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

interface RawSettings {
  provider: string;
  config: string;
}

export interface EffectiveProviderSettings {
  provider: ProviderName | 'none';
  storedConfig: ProviderConfig;
  config: ProviderConfig;
  sources: {
    anthropicKey: ConfigSource;
    openaiKey: ConfigSource;
    groqKey: ConfigSource;
    ollamaUrl: ConfigSource;
  };
  localOnly: {
    enabled: boolean;
    forcedByEnv: boolean;
  };
}

function parseConfig(raw: string | undefined): ProviderConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ProviderConfig;
    return {
      ...parsed,
      anthropicKey: decryptSecret(parsed.anthropicKey),
      openaiKey: decryptSecret(parsed.openaiKey),
      groqKey: decryptSecret(parsed.groqKey),
    };
  } catch {
    return {};
  }
}

function serializeConfig(config: ProviderConfig): string {
  return JSON.stringify({
    ...config,
    anthropicKey: config.anthropicKey ? encryptSecret(config.anthropicKey) : undefined,
    openaiKey: config.openaiKey ? encryptSecret(config.openaiKey) : undefined,
    groqKey: config.groqKey ? encryptSecret(config.groqKey) : undefined,
  });
}

function providerSettingsId(userId?: string): string {
  if (getAppMode() === 'local') return 'singleton';
  return userId ?? getContextUserId() ?? LOCAL_USER_ID;
}

function sourceFor(envValue: string | undefined, storedValue: string | undefined): ConfigSource {
  if (envValue) return 'env';
  if (storedValue) return 'app';
  return 'unset';
}

function withV1(url: string): string {
  return url.replace(/\/+$/, '').endsWith('/v1') ? url.replace(/\/+$/, '') : `${url.replace(/\/+$/, '')}/v1`;
}

export async function readProviderSettings(userId?: string): Promise<{ provider: ProviderName | 'none'; config: ProviderConfig }> {
  const id = providerSettingsId(userId);
  const row = await getDbClient()
    .get<RawSettings>('SELECT provider, config FROM provider_settings WHERE id = ?', [id]);

  return {
    provider: (row?.provider ?? 'none') as ProviderName | 'none',
    config: parseConfig(row?.config),
  };
}

export async function writeProviderSettings(
  provider: ProviderName | 'none',
  config: ProviderConfig,
  userId?: string,
): Promise<void> {
  const id = providerSettingsId(userId);
  await getDbClient().run(`
      INSERT INTO provider_settings (id, provider, config, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        config = excluded.config,
        updated_at = excluded.updated_at
    `, [id, provider, serializeConfig(config), Date.now()]);
}

export async function readEffectiveProviderSettings(userId?: string): Promise<EffectiveProviderSettings> {
  const { provider, config: storedConfig } = await readProviderSettings(userId);
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const ollamaUrl = process.env.OLLAMA_BASE_URL;

  const config: ProviderConfig = {
    ...storedConfig,
    ...(anthropicKey ? { anthropicKey } : {}),
    ...(process.env.ANTHROPIC_MODEL ? { anthropicModel: process.env.ANTHROPIC_MODEL } : {}),
    ...(openaiKey ? { openaiKey } : {}),
    ...(process.env.OPENAI_MODEL ? { openaiModel: process.env.OPENAI_MODEL } : {}),
    ...(groqKey ? { groqKey } : {}),
    ...(process.env.GROQ_MODEL ? { groqModel: process.env.GROQ_MODEL } : {}),
    ...(ollamaUrl ? { ollamaUrl } : {}),
    ...(process.env.OLLAMA_MODEL ? { ollamaModel: process.env.OLLAMA_MODEL } : {}),
  };

  return {
    provider,
    storedConfig,
    config,
    sources: {
      anthropicKey: sourceFor(anthropicKey, storedConfig.anthropicKey),
      openaiKey: sourceFor(openaiKey, storedConfig.openaiKey),
      groqKey: sourceFor(groqKey, storedConfig.groqKey),
      ollamaUrl: sourceFor(ollamaUrl, storedConfig.ollamaUrl),
    },
    localOnly: {
      enabled: process.env.WORLDARCHITECT_LOCAL_ONLY === '1' || storedConfig.localOnly === true,
      forcedByEnv: process.env.WORLDARCHITECT_LOCAL_ONLY === '1',
    },
  };
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

export async function isLLMConfigured(): Promise<boolean> {
  const { provider, config, localOnly } = await readEffectiveProviderSettings();
  if (provider === 'none') return false;
  if (localOnly.enabled && provider !== 'ollama') return false;
  if (provider === 'ollama') return true;
  if (provider === 'anthropic') return !!config.anthropicKey;
  if (provider === 'openai') return !!config.openaiKey;
  if (provider === 'groq') return !!config.groqKey;
  return false;
}

/**
 * Build and return the active LLMProvider.
 * Throws with a user-friendly message when nothing is configured.
 */
export async function getProvider(): Promise<LLMProvider> {
  const { provider, config, localOnly } = await readEffectiveProviderSettings();
  if (localOnly.enabled && provider !== 'ollama') {
    throw new ProviderSafetyError(
      'LOCAL_ONLY_EGRESS_BLOCKED',
      'Local-only mode is enabled. Hosted LLM providers are blocked; switch to Ollama to use AI features.',
    );
  }

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
        withV1(config.ollamaUrl ?? 'http://localhost:11434'),
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
export const requireLLM = asyncHandler(async (
  _req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): Promise<void> => {
  const { provider, localOnly } = await readEffectiveProviderSettings();
  if (localOnly.enabled && provider !== 'ollama') {
    res.status(403).json({
      error: 'Local-only mode is enabled. Hosted LLM providers are blocked; switch to Ollama to use AI features.',
      code: 'LOCAL_ONLY_EGRESS_BLOCKED',
    });
    return;
  }

  if (!(await isLLMConfigured())) {
    res.status(503).json({
      error: 'No LLM provider configured.',
      hint: 'All manual editing features work without an LLM. Go to Settings to add an API key.',
    });
    return;
  }
  next();
});

/** Mask an API key for safe client display: `sk-ant-api03-xxxx...yyyy` → `sk-ant-****yyyy` */
export function maskKey(key: string | undefined): string | undefined {
  return maskSecret(key);
}
