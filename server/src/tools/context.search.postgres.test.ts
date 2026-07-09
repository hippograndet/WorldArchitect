import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { nanoid } from 'nanoid';
import { runPostgresMigrations } from '../db/storage.js';
import { logger } from '../observability/logger.js';

const { Client } = pg;

const DATABASE_URL = process.env.DRIFT_TEST_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgres://worldarchitect:worldarchitect@localhost:5432/worldarchitect';
const REQUIRE_POSTGRES = process.env.CI === 'true';

async function searchTitlesPostgres(client: pg.Client, worldId: string, query: string): Promise<string[]> {
  // Mirrors the postgres branch of executeContextTool's search_articles case
  // in context.ts. Keep these in sync if that query changes.
  const res = await client.query(
    `SELECT a.title
     FROM article_search_index s
     JOIN articles a ON a.id = s.article_id
     WHERE s.world_id = $1 AND s.search_vector @@ plainto_tsquery('english', $2)
     ORDER BY ts_rank(s.search_vector, plainto_tsquery('english', $2)) DESC
     LIMIT 10`,
    [worldId, query],
  );
  return res.rows.map((r: { title: string }) => r.title);
}

describe('search_articles (Postgres tsvector)', () => {
  let client: pg.Client | null = null;
  let schemaName = '';
  let postgresAvailable = true;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
    } catch (err) {
      if (REQUIRE_POSTGRES) throw err;
      postgresAvailable = false;
      logger.warn('context.search.postgres.skipped', {
        reason: 'postgres unavailable',
        error: (err as Error).message,
      });
      return;
    }

    schemaName = `search_test_${nanoid(8)}`;
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}", public`);
    await runPostgresMigrations(client);
    await client.query(`SELECT set_config('app.current_owner_id', 'owner1', false)`);
  });

  afterAll(async () => {
    if (!client) return;
    try {
      if (postgresAvailable && schemaName) {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await client.query('DISCARD ALL');
      }
    } finally {
      await client.end();
    }
  });

  it('ranks a title match above a description-only match', async ({ skip }) => {
    if (!postgresAvailable) {
      skip();
      return;
    }

    await client!.query(`
      INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
      VALUES ('w1', 'owner1', 'TestWorld', 'desc', '[]', 'narrative', '{}', 0, 0)
    `);
    await client!.query(`
      INSERT INTO articles (id, owner_id, world_id, title, status, template_type, depth, created_at, updated_at)
      VALUES ('a1', 'owner1', 'w1', 'Phoenix', 'draft', 'general', 1, 0, 0),
             ('a2', 'owner1', 'w1', 'The Ash Fields', 'draft', 'general', 1, 0, 0)
    `);
    await client!.query(`
      INSERT INTO article_search_index (article_id, world_id, title, description, updated_at)
      VALUES ('a1', 'w1', 'Phoenix', 'A creature reborn from ash.', 0),
             ('a2', 'w1', 'The Ash Fields', 'A phoenix was once seen here.', 0)
    `);

    const titles = await searchTitlesPostgres(client!, 'w1', 'phoenix');
    expect(titles[0]).toBe('Phoenix');
  });

  it('does not error on adversarial query text', async ({ skip }) => {
    if (!postgresAvailable) {
      skip();
      return;
    }

    await expect(searchTitlesPostgres(client!, 'w1', 'dragon" OR 1=1')).resolves.toBeDefined();
    await expect(searchTitlesPostgres(client!, 'w1', '-keep & | !')).resolves.toBeDefined();
    await expect(searchTitlesPostgres(client!, 'w1', '')).resolves.toEqual([]);
  });
});
