import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb } from '../db/index.js';

// mergeParams: true exposes :wid from the parent /api/worlds/:wid router
const router = Router({ mergeParams: true });

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(200),
});

const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).optional(),
  hidden: z.boolean().optional(),
});

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

function requireWorld(worldId: string): boolean {
  const db = getDb();
  return !!db.prepare('SELECT id FROM worlds WHERE id = ?').get(worldId);
}

// GET /api/worlds/:wid/categories
router.get('/', (req, res) => {
  if (!requireWorld((req.params as Record<string, string>).wid)) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM categories WHERE world_id = ? ORDER BY sort_order, created_at')
    .all((req.params as Record<string, string>).wid) as Record<string, unknown>[];

  res.json(rows.map(parseCategory));
});

// POST /api/worlds/:wid/categories
router.post('/', (req, res) => {
  if (!requireWorld((req.params as Record<string, string>).wid)) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const parse = CreateCategorySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const db = getDb();
  const now = Date.now();

  // Place new category after the last existing one
  const lastOrder = db
    .prepare('SELECT MAX(sort_order) as max_order FROM categories WHERE world_id = ?')
    .get((req.params as Record<string, string>).wid) as { max_order: number | null };
  const sortOrder = (lastOrder.max_order ?? -1) + 1;

  const id = nanoid();
  db.prepare(`
    INSERT INTO categories (id, world_id, name, sort_order, hidden, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(id, (req.params as Record<string, string>).wid, parse.data.name, sortOrder, now);

  const row = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(id) as Record<string, unknown>;

  res.status(201).json(parseCategory(row));
});

// PATCH /api/worlds/:wid/categories/:cid
router.patch('/:cid', (req, res) => {
  const parse = UpdateCategorySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM categories WHERE id = ? AND world_id = ?')
    .get(req.params.cid, (req.params as Record<string, string>).wid) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const data = parse.data;
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined)      { fields.push('name = ?');       values.push(data.name); }
  if (data.sortOrder !== undefined)  { fields.push('sort_order = ?'); values.push(data.sortOrder); }
  if (data.hidden !== undefined)     { fields.push('hidden = ?');     values.push(data.hidden ? 1 : 0); }

  if (fields.length === 0) {
    res.json(parseCategory(existing));
    return;
  }

  values.push(req.params.cid);
  db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const updated = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(req.params.cid) as Record<string, unknown>;

  res.json(parseCategory(updated));
});

// DELETE /api/worlds/:wid/categories/:cid
router.delete('/:cid', (req, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM categories WHERE id = ? AND world_id = ?')
    .get(req.params.cid, (req.params as Record<string, string>).wid);

  if (!existing) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.cid);
  res.status(204).send();
});

export default router;
