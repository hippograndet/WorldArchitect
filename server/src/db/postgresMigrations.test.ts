import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { nanoid } from 'nanoid';
import { POSTGRES_MIGRATIONS, runPostgresMigrations } from './storage.js';
import { logger } from '../observability/logger.js';

const { Client } = pg;

const DATABASE_URL = process.env.DRIFT_TEST_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgres://worldarchitect:worldarchitect@localhost:5432/worldarchitect';
const REQUIRE_POSTGRES = process.env.CI === 'true';

describe('Postgres migrations', () => {
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
      logger.warn('postgresMigrations.skipped', { reason: 'postgres unavailable', error: (err as Error).message });
      return;
    }

    schemaName = `migration_test_${nanoid(8)}`;
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}", public`);
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

  it('records applied migrations and does not replay them', async ({ skip }) => {
    if (!postgresAvailable) {
      skip();
      return;
    }

    await runPostgresMigrations(client!);
    const first = await client!.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename',
    );
    expect(first.rows.map((row) => row.filename)).toEqual([...POSTGRES_MIGRATIONS]);

    await runPostgresMigrations(client!);
    const second = await client!.query<{ count: string }>('SELECT COUNT(*) AS count FROM schema_migrations');
    expect(Number(second.rows[0]?.count)).toBe(POSTGRES_MIGRATIONS.length);

    const rlsTables = [
      'worlds',
      'categories',
      'articles',
      'article_versions',
      'article_links',
      'cost_settings',
      'provider_settings',
      'call_log',
      'coherence_warnings',
      'world_snapshots',
      'pending_drafts',
      'name_bank',
      'auditor_edge_proposals',
      'entity_mentions',
      'article_issues',
      'publish_history',
      'world_issues',
      'runs',
      'run_events',
      'article_search_index',
      'checkpoints',
      'checkpoint_blobs',
      'checkpoint_writes',
    ];
    const rls = await client!.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r'
         AND n.nspname = $2
         AND c.relname = ANY($1)
       ORDER BY c.relname`,
      [rlsTables, schemaName],
    );
    expect(rls.rows).toHaveLength(rlsTables.length);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });
});
