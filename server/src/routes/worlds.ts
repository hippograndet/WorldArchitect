import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireLLM } from '../providers/index.js';
import { StylistAgent } from '../agents/stylist.js';
import type { PromptEngineerFieldType } from '../prompts/promptEngineer.js';
import { writeArticleVersionAndSetCurrent } from '../services/articleVersions.js';
import { reindexArticle } from '../services/searchIndex.js';
import { getTenantContext, worldBelongsToTenant } from '../tenant.js';

const router = Router();

const StyleConfigSchema = z.object({
  preset:       z.string().optional(),
  tonePreset:   z.string().optional(),
  tonePresetValue: z.string().optional(),
  toneGuidance: z.string().optional().default(''),
  vibePreset:   z.string().optional(),
  vibePresetValue: z.string().optional(),
  vibe:         z.string().optional().default(''),
  writingStylePreset: z.string().optional(),
  writingStylePresetValue: z.string().optional(),
  writingStyle: z.string().optional().default(''),
  inspirations: z.array(z.object({
    name: z.string(),
  })).optional().default([]),
  constraints:  z.string().optional(),
}).optional();

const CreateWorldSchema = z.object({
  name:          z.string().min(1).max(200),
  description:   z.string().min(20),
  tags:          z.array(z.string()).optional().default([]),
  tone:          z.enum(['narrative', 'academic', 'terse', 'custom']).optional().default('narrative'),
  originPoint:   z.string().optional(),
  styleConfig:   StyleConfigSchema,
});

const DEFAULT_CATEGORIES = [
  'Religion', 'Technology', 'Politics', 'Economy',
  'Culture', 'Geography', 'History', 'Notable Figures',
];

const UpdateWorldSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  description: z.string().min(20).optional(),
  tags:        z.array(z.string()).optional(),
  tone:        z.enum(['narrative', 'academic', 'terse', 'custom']).optional(),
  originPoint: z.string().nullable().optional(),
  styleConfig: StyleConfigSchema,
});

function parseWorld(row: Record<string, unknown>) {
  let styleConfig = null;
  try { styleConfig = JSON.parse((row.style_config as string) || '{}'); } catch { /* ignore */ }
  return {
    id:          row.id,
    name:        row.name,
    description: row.description,
    tags:        JSON.parse(row.tags as string),
    tone:        row.tone,
    originPoint: row.origin_point ?? null,
    styleConfig: styleConfig && Object.keys(styleConfig).length > 0 ? styleConfig : null,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

// POST /api/worlds — create world
router.post('/', asyncHandler(async (req, res) => {
  const parse = CreateWorldSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { name, description, tags, tone, originPoint, styleConfig } = parse.data;
  const exec = getDbClient();
  const ownerId = getTenantContext(req).ownerId;
  const now = Date.now();
  const worldId = nanoid();
  const articleId = nanoid();
  const versionId = nanoid();
  const styleConfigJson = JSON.stringify(styleConfig ?? {});

  await exec.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO worlds (id, owner_id, name, description, tags, tone, origin_point, style_config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [worldId, ownerId, name, description, JSON.stringify(tags), tone, originPoint ?? null, styleConfigJson, now, now]);

    await tx.run(`
      INSERT INTO cost_settings (world_id, owner_id, daily_cap, bible_threshold)
      VALUES (?, ?, NULL, 80000)
    `, [worldId, ownerId]);

    for (const [index, categoryName] of DEFAULT_CATEGORIES.entries()) {
      await tx.run(`
        INSERT INTO categories (id, world_id, owner_id, name, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [nanoid(), worldId, ownerId, categoryName, index, now]);
    }

    await tx.run(`
      INSERT INTO articles (id, world_id, owner_id, title, status, template_type, depth, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'draft', 'general', 1, ?, ?)
    `, [articleId, worldId, ownerId, name, now, now]);

    await writeArticleVersionAndSetCurrent(tx, {
      articleId,
      ownerId,
      versionId,
      versionNumber: 1,
      introduction: description,
      description: '',
      now,
    });

    // Set after the article row exists — worlds.root_article_id has no FK
    // constraint (same reasoning as articles.current_version_id), but the
    // article must still exist first for this pointer to mean anything.
    await tx.run('UPDATE worlds SET root_article_id = ? WHERE id = ?', [articleId, worldId]);
  });

  await reindexArticle(worldId, articleId);

  const world = await exec.get<Record<string, unknown>>('SELECT * FROM worlds WHERE id = ? AND owner_id = ?', [worldId, ownerId]);
  const categories = await exec.all(
    'SELECT id, name, sort_order AS sortOrder FROM categories WHERE world_id = ? AND owner_id = ? ORDER BY sort_order',
    [worldId, ownerId],
  );

  res.status(201).json({ world: parseWorld(world!), rootArticleId: articleId, categories });
}));

// GET /api/worlds — list all worlds
router.get('/', asyncHandler(async (req, res) => {
  const rows = await getDbClient().all<Record<string, unknown>>(
    'SELECT * FROM worlds WHERE owner_id = ? ORDER BY updated_at DESC',
    [getTenantContext(req).ownerId],
  );
  res.json(rows.map(parseWorld));
}));

// GET /api/worlds/:wid — get single world
router.get('/:wid', asyncHandler(async (req, res) => {
  const row = await getDbClient().get<Record<string, unknown>>(
    'SELECT * FROM worlds WHERE id = ? AND owner_id = ?',
    [req.params.wid, getTenantContext(req).ownerId],
  );

  if (!row) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  res.json(parseWorld(row));
}));

// PATCH /api/worlds/:wid — update world fields
router.patch('/:wid', asyncHandler(async (req, res) => {
  const parse = UpdateWorldSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const exec = getDbClient();
  const existing = await exec.get<Record<string, unknown>>(
    'SELECT * FROM worlds WHERE id = ? AND owner_id = ?',
    [req.params.wid, getTenantContext(req).ownerId],
  );

  if (!existing) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const data = parse.data;
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined)        { fields.push('name = ?');         values.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?');  values.push(data.description); }
  if (data.tags !== undefined)        { fields.push('tags = ?');          values.push(JSON.stringify(data.tags)); }
  if (data.tone !== undefined)        { fields.push('tone = ?');          values.push(data.tone); }
  if (data.originPoint !== undefined) { fields.push('origin_point = ?'); values.push(data.originPoint); }
  if (data.styleConfig !== undefined) { fields.push('style_config = ?'); values.push(JSON.stringify(data.styleConfig ?? {})); }

  if (fields.length === 0) {
    res.json(parseWorld(existing));
    return;
  }

  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(req.params.wid);
  values.push(getTenantContext(req).ownerId);

  await exec.run(`UPDATE worlds SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`, values);

  const updated = await exec.get<Record<string, unknown>>(
    'SELECT * FROM worlds WHERE id = ? AND owner_id = ?',
    [req.params.wid, getTenantContext(req).ownerId],
  );

  res.json(parseWorld(updated!));
}));

// DELETE /api/worlds/:wid
router.delete('/:wid', asyncHandler(async (req, res) => {
  const exec = getDbClient();
  const ownerId = getTenantContext(req).ownerId;
  const existing = await exec.get('SELECT id FROM worlds WHERE id = ? AND owner_id = ?', [req.params.wid, ownerId]);
  if (!existing) {
    res.status(404).json({ error: 'World not found' });
    return;
  }
  await exec.run('DELETE FROM worlds WHERE id = ? AND owner_id = ?', [req.params.wid, ownerId]);
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// POST /api/worlds/prompt-engineer — PromptEngineerAgent (no wid needed)
// Also POST /api/worlds/:wid/prompt-engineer — for post-creation edits
// ---------------------------------------------------------------------------

const PromptEngineerSchema = z.object({
  fieldType:           z.enum(['vibe', 'writing_style', 'distill', 'charter_assist', 'article_brief', 'intro_seed', 'prompt_lab']),
  rawText:             z.string().min(1),
  worldName:           z.string().min(1),
  worldDescription:    z.string().min(1),
  currentVibe:         z.string().optional(),
  currentWritingStyle: z.string().optional(),
  currentAuthority:    z.string().optional(),
  articleTitle:        z.string().optional(),
  articleType:         z.string().optional(),
  focus:               z.string().optional(),
});

const handlePromptEngineer = asyncHandler(async (req, res) => {
  const parse = PromptEngineerSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { fieldType, rawText, worldName, worldDescription, currentVibe, currentWritingStyle, currentAuthority, articleTitle, articleType, focus } = parse.data;
  const worldId = (req.params as Record<string, string>).wid ?? 'wizard';
  if (worldId !== 'wizard' && !(await worldBelongsToTenant(worldId, getTenantContext(req).ownerId))) {
    res.status(404).json({ error: 'World not found', code: 'NOT_FOUND' });
    return;
  }

  const agent = new StylistAgent();
  const result = await agent.run(worldId, {
    fieldType: fieldType as PromptEngineerFieldType,
    rawText,
    worldName,
    worldDescription,
    currentVibe,
    currentWritingStyle,
    currentAuthority,
    articleTitle,
    articleType,
    focus,
  });

  if (result.output.mode === 'distill') {
    res.json({ vibe_append: result.output.vibe_append, writingStyle_append: result.output.writingStyle_append });
  } else if (result.output.mode === 'charter_assist') {
    res.json({
      premiseSuggestions: result.output.premiseSuggestions,
      authoritySuggestions: result.output.authoritySuggestions,
      atmosphereSuggestions: result.output.atmosphereSuggestions,
      proseSuggestions: result.output.proseSuggestions,
      rationale: result.output.rationale,
    });
  } else if (result.output.mode === 'article_brief') {
    res.json({ userSpec: result.output.userSpec });
  } else if (result.output.mode === 'intro_seed') {
    res.json({ introduction: result.output.introduction });
  } else {
    res.json({ expandedDescription: result.output.expandedDescription });
  }
});

router.post('/prompt-engineer', requireLLM, handlePromptEngineer);
router.post('/:wid/prompt-engineer', requireLLM, handlePromptEngineer);

export default router;
