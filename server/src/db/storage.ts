import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type pg from 'pg';
import { getDb, DB_PATH } from './index.js';
import { getStorageDriver } from '../config.js';
import { getPgPool } from './pgPool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const POSTGRES_MIGRATIONS = [
  '001_initial.sql',
  '002_full_schema.sql',
  '003_runs.sql',
  '004_call_log_instrumentation.sql',
  '005_search_index.sql',
] as const;

export type StorageHealth = {
  driver: 'sqlite' | 'postgres';
  ok: boolean;
  detail: string;
};

export interface StorageAdapter {
  readonly driver: 'sqlite' | 'postgres';
  health(): Promise<StorageHealth>;
  migrate(): Promise<void>;
}

class SqliteStorageAdapter implements StorageAdapter {
  readonly driver = 'sqlite' as const;

  async health(): Promise<StorageHealth> {
    const tables = getDb()
      .prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'`)
      .get() as { count: number };
    return { driver: this.driver, ok: true, detail: `${DB_PATH} (${tables.count} tables)` };
  }

  async migrate(): Promise<void> {
    getDb();
  }
}

class PostgresStorageAdapter implements StorageAdapter {
  readonly driver = 'postgres' as const;

  async health(): Promise<StorageHealth> {
    if (!process.env.DATABASE_URL) {
      return { driver: this.driver, ok: false, detail: 'DATABASE_URL is not set' };
    }
    const client = await getPgPool().connect();
    try {
      const result = await client.query<{ now: Date }>('SELECT NOW() AS now');
      return { driver: this.driver, ok: true, detail: `connected at ${result.rows[0]?.now?.toISOString?.() ?? 'unknown'}` };
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Postgres migrations');
    const client = await getPgPool().connect();
    try {
      await runPostgresMigrations(client);
    } finally {
      client.release();
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
    adapter = getStorageDriver() === 'postgres' ? new PostgresStorageAdapter() : new SqliteStorageAdapter();
  }
  return adapter;
}
