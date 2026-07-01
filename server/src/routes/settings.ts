import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  readProviderSettings,
  readEffectiveProviderSettings,
  writeProviderSettings,
  getProvider,
  maskKey,
} from '../providers/index.js';
import { redactErrorMessage } from '../security/redaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { ProviderName, ProviderConfig } from '../providers/index.js';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const UpdateProviderSchema = z.object({
  provider: z.enum(['none', 'anthropic', 'openai', 'groq', 'ollama']),
  apiKey: z.string().optional(),       // key for the selected provider
  model: z.string().optional(),        // model override for the selected provider
  ollamaUrl: z.string().url().optional(),
  localOnly: z.boolean().optional(),
});

const UpdateCostSettingsSchema = z.object({
  dailyCap: z.number().int().positive().nullable().optional(),
  bibleThreshold: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// Global provider settings  GET /api/settings
// ---------------------------------------------------------------------------

router.get('/', (_req, res) => {
  const { provider, config, sources, localOnly } = readEffectiveProviderSettings();

  res.json({
    provider,
    isConfigured: provider !== 'none',
    localOnly,
    anthropic: {
      keySet: !!config.anthropicKey,
      keyMasked: maskKey(config.anthropicKey),
      keySource: sources.anthropicKey,
      model: config.anthropicModel ?? 'claude-sonnet-4-6',
    },
    openai: {
      keySet: !!config.openaiKey,
      keyMasked: maskKey(config.openaiKey),
      keySource: sources.openaiKey,
      model: config.openaiModel ?? 'gpt-4o',
    },
    groq: {
      keySet: !!config.groqKey,
      keyMasked: maskKey(config.groqKey),
      keySource: sources.groqKey,
      model: config.groqModel ?? 'llama-3.3-70b-versatile',
    },
    ollama: {
      url: config.ollamaUrl ?? 'http://localhost:11434',
      urlSource: sources.ollamaUrl,
      model: config.ollamaModel ?? 'llama3',
    },
  });
});

// PATCH /api/settings — set active provider + store its key/model
router.patch('/', (req, res) => {
  const parse = UpdateProviderSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { provider, apiKey, model, ollamaUrl, localOnly } = parse.data;
  const { config: existing } = readProviderSettings();

  // Merge — only overwrite the fields relevant to the selected provider.
  const updated: ProviderConfig = { ...existing };

  if (provider === 'anthropic') {
    if (apiKey)  updated.anthropicKey   = apiKey;
    if (model)   updated.anthropicModel = model;
  } else if (provider === 'openai') {
    if (apiKey)  updated.openaiKey   = apiKey;
    if (model)   updated.openaiModel = model;
  } else if (provider === 'groq') {
    if (apiKey)  updated.groqKey   = apiKey;
    if (model)   updated.groqModel = model;
  } else if (provider === 'ollama') {
    if (ollamaUrl) updated.ollamaUrl   = ollamaUrl;
    if (model)     updated.ollamaModel = model;
  }

  if (localOnly !== undefined && process.env.WORLDARCHITECT_LOCAL_ONLY !== '1') {
    updated.localOnly = localOnly;
  }

  writeProviderSettings(provider as ProviderName | 'none', updated);

  const effective = readEffectiveProviderSettings();
  res.json({ ok: true, provider, localOnly: effective.localOnly });
});

// POST /api/settings/test — fire a minimal completion to verify the key works
router.post('/test', asyncHandler(async (_req, res) => {
  try {
    const provider = getProvider();
    const result = await provider.complete(
      [{ role: 'user', content: 'Reply with the single word: ok' }],
      { maxTokens: 10 },
    );
    res.json({ ok: true, provider: provider.name, response: result.content.trim() });
  } catch (err) {
    const message = redactErrorMessage(err);
    res.status(400).json({ ok: false, error: message });
  }
}));

// GET /api/settings/ollama/models — list models available in the local Ollama daemon
router.get('/ollama/models', asyncHandler(async (_req, res) => {
  const { config } = readEffectiveProviderSettings();
  const base = (config.ollamaUrl ?? 'http://localhost:11434').replace(/\/v1\/?$/, '');

  try {
    const response = await fetch(`${base}/api/tags`);
    if (!response.ok) throw new Error(`Ollama responded ${response.status}`);
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    res.json({ models: (data.models ?? []).map((m) => m.name) });
  } catch (err) {
    const message = redactErrorMessage(err, 'Cannot reach Ollama');
    res.status(503).json({ error: message, hint: 'Is Ollama running on your machine?' });
  }
}));

// ---------------------------------------------------------------------------
// Per-world cost settings  GET|PATCH /api/worlds/:wid/settings
// (mounted separately in index.ts under /api/worlds/:wid/settings)
// ---------------------------------------------------------------------------

export const worldSettingsRouter = Router({ mergeParams: true });

worldSettingsRouter.get('/', (req, res) => {
  const settings = getDb()
    .prepare('SELECT * FROM cost_settings WHERE world_id = ?')
    .get((req.params as Record<string, string>).wid) as { daily_cap: number | null; bible_threshold: number } | undefined;

  if (!settings) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  res.json({
    dailyCap: settings.daily_cap,
    bibleThreshold: settings.bible_threshold,
  });
});

worldSettingsRouter.patch('/', (req, res) => {
  const parse = UpdateCostSettingsSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const existing = getDb()
    .prepare('SELECT * FROM cost_settings WHERE world_id = ?')
    .get((req.params as Record<string, string>).wid) as { daily_cap: number | null; bible_threshold: number } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const { dailyCap, bibleThreshold } = parse.data;
  const fields: string[] = [];
  const values: unknown[] = [];

  if (dailyCap !== undefined)       { fields.push('daily_cap = ?');       values.push(dailyCap); }
  if (bibleThreshold !== undefined) { fields.push('bible_threshold = ?'); values.push(bibleThreshold); }

  if (fields.length > 0) {
    values.push((req.params as Record<string, string>).wid);
    getDb()
      .prepare(`UPDATE cost_settings SET ${fields.join(', ')} WHERE world_id = ?`)
      .run(...values);
  }

  const updated = getDb()
    .prepare('SELECT * FROM cost_settings WHERE world_id = ?')
    .get((req.params as Record<string, string>).wid) as { daily_cap: number | null; bible_threshold: number };

  res.json({ dailyCap: updated.daily_cap, bibleThreshold: updated.bible_threshold });
});

export default router;
