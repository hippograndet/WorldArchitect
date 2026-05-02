import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Hoist DB ref so the mock factory can close over it
// ---------------------------------------------------------------------------

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

vi.mock('../providers/index.js', () => ({
  isLLMConfigured: () => false,
  requireLLM: (_req: unknown, _res: unknown, next: () => void) => next(),
  getProvider: () => { throw new Error('No LLM configured'); },
  maskKey: (k: string) => k,
}));

vi.mock('../agents/director.js', () => ({
  PipelineCoordinator: vi.fn(() => ({
    createWorld: vi.fn().mockResolvedValue({ stubs: [] }),
  })),
}));

// ---------------------------------------------------------------------------
// App setup (imports happen after mocks are registered)
// ---------------------------------------------------------------------------

import express from 'express';
import supertest from 'supertest';
import worldsRouter from './worlds.js';

const app = express();
app.use(express.json());
app.use('/api/worlds', worldsRouter);
const req = supertest(app);

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;
});

function clearWorlds() {
  dbRef.db!.exec(`
    DELETE FROM world_bible_entries;
    DELETE FROM world_bible_meta;
    DELETE FROM cost_settings;
    DELETE FROM categories;
    DELETE FROM worlds;
  `);
}

beforeEach(clearWorlds);

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createWorld(overrides: Record<string, unknown> = {}) {
  return req.post('/api/worlds').send({
    name: 'Middle-Earth',
    description: 'A world of hobbits and dragons and ancient wars.',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// POST /api/worlds
// ---------------------------------------------------------------------------

describe('POST /api/worlds', () => {
  it('returns 201 with world and categories on valid input', async () => {
    const res = await createWorld();
    expect(res.status).toBe(201);
    expect(res.body.world).toMatchObject({
      name: 'Middle-Earth',
      tone: 'narrative',
      originPoint: null,
      tags: [],
    });
    expect(res.body.world.id).toBeTruthy();
    expect(res.body.categories).toHaveLength(8);
  });

  it('creates exactly the 8 default categories in order', async () => {
    const res = await createWorld();
    const names = res.body.categories.map((c: { name: string }) => c.name);
    expect(names).toEqual([
      'Religion', 'Technology', 'Politics', 'Economy',
      'Culture', 'Geography', 'History', 'Notable Figures',
    ]);
  });

  it('persists world fields correctly', async () => {
    const res = await createWorld({
      name: 'Westeros',
      description: 'A land of scheming nobles and long winters that last for years.',
      tags: ['fantasy', 'medieval'],
      tone: 'academic',
      originPoint: 'The Doom of Valyria',
    });
    expect(res.body.world).toMatchObject({
      name: 'Westeros',
      tone: 'academic',
      originPoint: 'The Doom of Valyria',
      tags: ['fantasy', 'medieval'],
    });
  });

  it('returns 400 when name is missing', async () => {
    const res = await req.post('/api/worlds').send({
      description: 'A world with a long enough description.',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when name is empty string', async () => {
    const res = await req.post('/api/worlds').send({
      name: '',
      description: 'A world with a long enough description.',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when description is too short (< 20 chars)', async () => {
    const res = await req.post('/api/worlds').send({
      name: 'My World',
      description: 'Too short',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid tone value', async () => {
    const res = await req.post('/api/worlds').send({
      name: 'My World',
      description: 'A world with a long enough description.',
      tone: 'mystery', // not in enum
    });
    expect(res.status).toBe(400);
  });

  it('accepts all valid tone values', async () => {
    for (const tone of ['narrative', 'academic', 'terse', 'custom']) {
      clearWorlds();
      const res = await createWorld({ tone });
      expect(res.status).toBe(201);
      expect(res.body.world.tone).toBe(tone);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/worlds
// ---------------------------------------------------------------------------

describe('GET /api/worlds', () => {
  it('returns empty array when no worlds exist', async () => {
    const res = await req.get('/api/worlds');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all worlds', async () => {
    await createWorld({ name: 'World A', description: 'A long enough description for world A.' });
    await createWorld({ name: 'World B', description: 'A long enough description for world B.' });
    const res = await req.get('/api/worlds');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('returns worlds sorted by updatedAt DESC (most recent first)', async () => {
    await createWorld({ name: 'First', description: 'A long enough description for First.' });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5));
    await createWorld({ name: 'Second', description: 'A long enough description for Second.' });
    const res = await req.get('/api/worlds');
    expect(res.body[0].name).toBe('Second');
    expect(res.body[1].name).toBe('First');
  });

  it('parses tags as JSON array, not a raw string', async () => {
    await createWorld({ tags: ['scifi', 'dystopian'] });
    const res = await req.get('/api/worlds');
    expect(Array.isArray(res.body[0].tags)).toBe(true);
    expect(res.body[0].tags).toContain('scifi');
  });
});

// ---------------------------------------------------------------------------
// GET /api/worlds/:wid
// ---------------------------------------------------------------------------

describe('GET /api/worlds/:wid', () => {
  it('returns the world when it exists', async () => {
    const { body: { world } } = await createWorld();
    const res = await req.get(`/api/worlds/${world.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(world.id);
    expect(res.body.name).toBe('Middle-Earth');
  });

  it('returns 404 for a non-existent world id', async () => {
    const res = await req.get('/api/worlds/ghost-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('World not found');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/worlds/:wid
// ---------------------------------------------------------------------------

describe('PATCH /api/worlds/:wid', () => {
  it('updates the name field', async () => {
    const { body: { world } } = await createWorld();
    const res = await req.patch(`/api/worlds/${world.id}`).send({ name: 'Renamed World' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed World');
  });

  it('updates the description field', async () => {
    const { body: { world } } = await createWorld();
    const res = await req.patch(`/api/worlds/${world.id}`).send({
      description: 'A freshly updated description that is long enough.',
    });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('A freshly updated description that is long enough.');
  });

  it('updates tags', async () => {
    const { body: { world } } = await createWorld();
    const res = await req.patch(`/api/worlds/${world.id}`).send({ tags: ['new', 'tags'] });
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual(['new', 'tags']);
  });

  it('updates originPoint including setting it to null', async () => {
    const { body: { world } } = await createWorld({ originPoint: 'The Big Bang' });
    const res = await req.patch(`/api/worlds/${world.id}`).send({ originPoint: null });
    expect(res.status).toBe(200);
    expect(res.body.originPoint).toBeNull();
  });

  it('returns existing world unchanged when body is empty', async () => {
    const { body: { world } } = await createWorld();
    const res = await req.patch(`/api/worlds/${world.id}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Middle-Earth');
  });

  it('returns 400 for an invalid tone', async () => {
    const { body: { world } } = await createWorld();
    const res = await req.patch(`/api/worlds/${world.id}`).send({ tone: 'whimsical' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when world does not exist', async () => {
    const res = await req.patch('/api/worlds/ghost').send({ name: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('World not found');
  });

  it('returns 400 when name is set to empty string', async () => {
    const { body: { world } } = await createWorld();
    const res = await req.patch(`/api/worlds/${world.id}`).send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('bumps updatedAt after a successful update', async () => {
    const { body: { world } } = await createWorld();
    await new Promise((r) => setTimeout(r, 5));
    const res = await req.patch(`/api/worlds/${world.id}`).send({ name: 'New Name' });
    expect(res.body.updatedAt).toBeGreaterThan(world.updatedAt);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/worlds/:wid
// ---------------------------------------------------------------------------

describe('DELETE /api/worlds/:wid', () => {
  it('returns 204 on successful deletion', async () => {
    const { body: { world } } = await createWorld();
    const res = await req.delete(`/api/worlds/${world.id}`);
    expect(res.status).toBe(204);
  });

  it('makes the world unreachable after deletion', async () => {
    const { body: { world } } = await createWorld();
    await req.delete(`/api/worlds/${world.id}`);
    const res = await req.get(`/api/worlds/${world.id}`);
    expect(res.status).toBe(404);
  });

  it('cascades to categories on deletion', async () => {
    const { body: { world } } = await createWorld();
    await req.delete(`/api/worlds/${world.id}`);
    const cats = dbRef.db!
      .prepare('SELECT * FROM categories WHERE world_id = ?')
      .all(world.id);
    expect(cats).toHaveLength(0);
  });

  it('cascades to world_bible_meta on deletion', async () => {
    const { body: { world } } = await createWorld();
    await req.delete(`/api/worlds/${world.id}`);
    const meta = dbRef.db!
      .prepare('SELECT * FROM world_bible_meta WHERE world_id = ?')
      .all(world.id);
    expect(meta).toHaveLength(0);
  });

  it('returns 404 for a non-existent world', async () => {
    const res = await req.delete('/api/worlds/ghost-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('World not found');
  });

  it('does not affect other worlds when one is deleted', async () => {
    await createWorld({ name: 'World A', description: 'A long enough description for World A.' });
    const { body: { world: worldB } } = await createWorld({
      name: 'World B',
      description: 'A long enough description for World B.',
    });
    await req.delete(`/api/worlds/${worldB.id}`);
    const res = await req.get('/api/worlds');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('World A');
  });
});
