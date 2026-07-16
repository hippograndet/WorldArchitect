import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { getPgPool } from './pgPool.js';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
export const POSTGRES_MIGRATIONS = [
  '001_initial.sql',
  '002_full_schema.sql',
  '003_runs.sql',
  '004_call_log_instrumentation.sql',
  '005_search_index.sql',
  '006_row_level_security.sql',
  '007_llm_traces.sql',
  '008_run_review_items.sql',
  '009_article_metadata_facts.sql',
  '010_entity_mentions_pending.sql',
  '011_draft_bundles.sql',
  '012_run_items_failed.sql',
  '013_drop_world_bible_entries.sql',
  '014_publish_pointer_and_link_provenance.sql',
  '015_world_root_article.sql',
  '016_run_queue_items.sql',
] as const;

export type StorageHealth = {
  ok: boolean;
  detail: string;
};

export interface StorageAdapter {
  health(): Promise<StorageHealth>;
  migrate(): Promise<void>;
}

class PostgresStorageAdapter implements StorageAdapter {
  async health(): Promise<StorageHealth> {
    if (!process.env.DATABASE_URL) {
      return { ok: false, detail: 'DATABASE_URL is not set' };
    }
    const client = await getPgPool().connect();
    try {
      const result = await client.query<{ now: Date }>('SELECT NOW() AS now');
      return { ok: true, detail: `connected at ${result.rows[0]?.now?.toISOString?.() ?? 'unknown'}` };
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Postgres migrations');
    const migrationUrl = process.env.MIGRATION_DATABASE_URL;
    if (migrationUrl && migrationUrl !== process.env.DATABASE_URL) {
      const client = new Client({ connectionString: migrationUrl });
      try {
        await client.connect();
        await runPostgresMigrations(client);
      } finally {
        await client.end();
      }
      return;
    }

    const pooledClient = await getPgPool().connect();
    try {
      await runPostgresMigrations(pooledClient);
    } finally {
      pooledClient.release();
    }
  }
}

export async function runPostgresMigrations(client: pg.PoolClient | pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const appliedFiles = new Set(applied.rows.map((row) => row.filename));

  for (const file of POSTGRES_MIGRATIONS) {
    if (appliedFiles.has(file)) continue;

    const sql = readFileSync(resolve(__dirname, 'migrations/postgres', file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}

let adapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (!adapter) {
    adapter = new PostgresStorageAdapter();
  }
  return adapter;
}
