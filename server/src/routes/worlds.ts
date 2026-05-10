import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { isLLMConfigured, requireLLM } from '../providers/index.js';
import { PipelineCoordinator } from '../agents/director.js';
import { StylistAgent } from '../agents/stylist.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { PromptEngineerFieldType } from '../prompts/promptEngineer.js';

const router = Router();

const StyleConfigSchema = z.object({
  preset:       z.string().optional(),
  vibe:         z.string().optional().default(''),
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
  generateStubs: z.boolean().optional().default(false),
});

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

  const { name, description, tags, tone, originPoint, styleConfig, generateStubs } = parse.data;
  const db = getDb();
  const now = Date.now();
  const worldId = nanoid();
  const articleId = nanoid();
  const versionId = nanoid();
  const wordCount = description.split(/\s+/).filter(Boolean).length;
  const styleConfigJson = JSON.stringify(styleConfig ?? {});

  db.transaction(() => {
    db.prepare(`
      INSERT INTO worlds (id, name, description, tags, tone, origin_point, style_config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(worldId, name, description, JSON.stringify(tags), tone, originPoint ?? null, styleConfigJson, now, now);

    db.prepare(`
      INSERT INTO cost_settings (world_id, daily_cap, bible_threshold)
      VALUES (?, NULL, 80000)
    `).run(worldId);

    db.prepare(`
      INSERT INTO world_bible_meta (world_id, token_count, updated_at)
      VALUES (?, 0, ?)
    `).run(worldId, now);

    db.prepare(`
      INSERT INTO articles (id, world_id, title, status, template_type, depth, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', 'general', 1, ?, ?)
    `).run(articleId, worldId, name, now, now);

    db.prepare(`
      INSERT INTO article_versions (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
      VALUES (?, ?, 1, '', ?, '', ?, ?)
    `).run(versionId, articleId, description, wordCount, now);

    db.prepare(`UPDATE articles SET current_version_id = ? WHERE id = ?`).run(versionId, articleId);

    db.prepare(`
      INSERT INTO world_bible_entries (id, world_id, article_id, summary, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(nanoid(), worldId, articleId, description, now);
  })();

  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId) as Record<string, unknown>;

  if (generateStubs && isLLMConfigured()) {
    try {
      const seedText = [description, originPoint].filter(Boolean).join('\n\n');
      const director = new PipelineCoordinator();
      const skeletonResult = await director.createWorld(worldId, seedText);
      res.status(201).json({ world: parseWorld(world), rootArticleId: articleId, stubs: skeletonResult.stubs });
      return;
    } catch {
      // SkeletonAgent failure must not block world creation
    }
  }

  res.status(201).json({ world: parseWorld(world), rootArticleId: articleId });
}));

// GET /api/worlds — list all worlds
router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM worlds ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[];
  res.json(rows.map(parseWorld));
});

// GET /api/worlds/:wid — get single world
router.get('/:wid', (req, res) => {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM worlds WHERE id = ?')
    .get(req.params.wid) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  res.json(parseWorld(row));
});

// PATCH /api/worlds/:wid — update world fields
router.patch('/:wid', (req, res) => {
  const parse = UpdateWorldSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM worlds WHERE id = ?')
    .get(req.params.wid) as Record<string, unknown> | undefined;

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

  db.prepare(`UPDATE worlds SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const updated = db
    .prepare('SELECT * FROM worlds WHERE id = ?')
    .get(req.params.wid) as Record<string, unknown>;

  res.json(parseWorld(updated));
});

// DELETE /api/worlds/:wid
router.delete('/:wid', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM worlds WHERE id = ?').get(req.params.wid);
  if (!existing) {
    res.status(404).json({ error: 'World not found' });
    return;
  }
  db.prepare('DELETE FROM worlds WHERE id = ?').run(req.params.wid);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /api/worlds/prompt-engineer — PromptEngineerAgent (no wid needed)
// Also POST /api/worlds/:wid/prompt-engineer — for post-creation edits
// ---------------------------------------------------------------------------

const PromptEngineerSchema = z.object({
  fieldType:           z.enum(['vibe', 'writing_style', 'distill', 'article_brief', 'intro_seed', 'prompt_lab']),
  rawText:             z.string().min(1),
  worldName:           z.string().min(1),
  worldDescription:    z.string().min(1),
  currentVibe:         z.string().optional(),
  currentWritingStyle: z.string().optional(),
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

  const { fieldType, rawText, worldName, worldDescription, currentVibe, currentWritingStyle, articleTitle, articleType, focus } = parse.data;
  const worldId = (req.params as Record<string, string>).wid ?? 'wizard';

  const agent = new StylistAgent();
  const result = await agent.run(worldId, {
    fieldType: fieldType as PromptEngineerFieldType,
    rawText,
    worldName,
    worldDescription,
    currentVibe,
    currentWritingStyle,
    articleTitle,
    articleType,
    focus,
  });

  if (result.output.mode === 'distill') {
    res.json({ vibe_append: result.output.vibe_append, writingStyle_append: result.output.writingStyle_append });
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
