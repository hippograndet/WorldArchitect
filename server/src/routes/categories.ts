import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { tenantIdFor } from '../tenant.js';

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

async function requireWorld(worldId: string): Promise<boolean> {
  const row = await getDbClient().get('SELECT id FROM worlds WHERE id = ?', [worldId]);
  return !!row;
}

// GET /api/worlds/:wid/categories
router.get('/', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  if (!(await requireWorld(wid))) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const rows = await getDbClient().all<Record<string, unknown>>(
    'SELECT * FROM categories WHERE world_id = ? ORDER BY sort_order, created_at', [wid],
  );

  res.json(rows.map(parseCategory));
}));

// POST /api/worlds/:wid/categories
router.post('/', asyncHandler(async (req, res) => {
  const wid = (req.params as Record<string, string>).wid;
  if (!(await requireWorld(wid))) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const parse = CreateCategorySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const db = getDbClient();
  const now = Date.now();

  // Place new category after the last existing one
  const lastOrder = await db.get<{ max_order: number | null }>(
    'SELECT MAX(sort_order) as max_order FROM categories WHERE world_id = ?', [wid],
  );
  const sortOrder = (lastOrder?.max_order ?? -1) + 1;

  const id = nanoid();
  await db.run(`
    INSERT INTO categories (id, world_id, owner_id, name, sort_order, hidden, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `, [id, wid, tenantIdFor(req), parse.data.name, sortOrder, now]);

  const row = await db.get<Record<string, unknown>>('SELECT * FROM categories WHERE id = ?', [id]);

  res.status(201).json(parseCategory(row!));
}));

// PATCH /api/worlds/:wid/categories/:cid
router.patch('/:cid', asyncHandler(async (req, res) => {
  const parse = UpdateCategorySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten().fieldErrors });
    return;
  }

  const db = getDbClient();
  const wid = (req.params as Record<string, string>).wid;
  const existing = await db.get<Record<string, unknown>>(
    'SELECT * FROM categories WHERE id = ? AND world_id = ?', [req.params.cid, wid],
  );

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
  await db.run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);

  const updated = await db.get<Record<string, unknown>>('SELECT * FROM categories WHERE id = ?', [req.params.cid]);

  res.json(parseCategory(updated!));
}));

// DELETE /api/worlds/:wid/categories/:cid
router.delete('/:cid', asyncHandler(async (req, res) => {
  const db = getDbClient();
  const wid = (req.params as Record<string, string>).wid;
  const existing = await db.get(
    'SELECT id FROM categories WHERE id = ? AND world_id = ?', [req.params.cid, wid],
  );

  if (!existing) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  await db.run('DELETE FROM categories WHERE id = ?', [req.params.cid]);
  res.status(204).send();
}));

export default router;
