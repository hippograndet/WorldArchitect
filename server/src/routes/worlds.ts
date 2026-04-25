import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb } from '../db/index.js';

const router = Router();

const DEFAULT_CATEGORIES = [
  'Religion',
  'Technology',
  'Politics',
  'Economy',
  'Culture',
  'Geography',
  'History',
  'Notable Figures',
];

const CreateWorldSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(20),
  tags: z.array(z.string()).optional().default([]),
  tone: z.enum(['narrative', 'academic', 'terse', 'custom']).optional().default('narrative'),
  originPoint: z.string().optional(),
});

const UpdateWorldSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().min(20).optional(),
  tags: z.array(z.string()).optional(),
  tone: z.enum(['narrative', 'academic', 'terse', 'custom']).optional(),
  originPoint: z.string().nullable().optional(),
});

function parseWorld(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: JSON.parse(row.tags as string),
    tone: row.tone,
    originPoint: row.origin_point ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCategory(row: Record<string, unknown>) {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    sortOrder: row.sort_order,
    hidden: row.hidden === 1,
    createdAt: row.created_at,
  };
}

// POST /api/worlds — create world + 8 default categories
router.post('/', (req, res) => {
  const parse = CreateWorldSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const { name, description, tags, tone, originPoint } = parse.data;
  const db = getDb();
  const now = Date.now();
  const worldId = nanoid();

  const insertWorld = db.prepare(`
    INSERT INTO worlds (id, name, description, tags, tone, origin_point, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCategory = db.prepare(`
    INSERT INTO categories (id, world_id, name, sort_order, hidden, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `);
  const insertSettings = db.prepare(`
    INSERT INTO cost_settings (world_id, daily_cap, bible_threshold)
    VALUES (?, NULL, 80000)
  `);
  const insertBibleMeta = db.prepare(`
    INSERT INTO world_bible_meta (world_id, token_count, updated_at)
    VALUES (?, 0, ?)
  `);

  db.transaction(() => {
    insertWorld.run(
      worldId, name, description,
      JSON.stringify(tags), tone, originPoint ?? null,
      now, now,
    );
    DEFAULT_CATEGORIES.forEach((catName, i) => {
      insertCategory.run(nanoid(), worldId, catName, i, now);
    });
    insertSettings.run(worldId);
    insertBibleMeta.run(worldId, now);
  })();

  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId) as Record<string, unknown>;
  const categories = (
    db.prepare('SELECT * FROM categories WHERE world_id = ? ORDER BY sort_order').all(worldId) as Record<string, unknown>[]
  ).map(parseCategory);

  res.status(201).json({ world: parseWorld(world), categories });
});

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

// DELETE /api/worlds/:wid — delete world (cascades to all child tables)
router.delete('/:wid', (req, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM worlds WHERE id = ?')
    .get(req.params.wid);

  if (!existing) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  db.prepare('DELETE FROM worlds WHERE id = ?').run(req.params.wid);
  res.status(204).send();
});

export default router;
