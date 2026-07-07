import pg from 'pg';
import { nanoid } from 'nanoid';
import { closePgPool } from '../db/pgPool.js';
import { resetDbClientForTests } from '../db/client.js';
import { runPostgresMigrations } from '../db/storage.js';
import { logger } from '../observability/logger.js';

const { Client } = pg;
const REQUIRE_POSTGRES = process.env.CI === 'true';

export interface PostgresTestHarness {
  databaseName: string;
  databaseUrl: string;
  cleanup(): Promise<void>;
}

export async function setupPostgresTestHarness(prefix: string): Promise<PostgresTestHarness | null> {
  const baseUrl = process.env.DRIFT_TEST_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? 'postgres://worldarchitect:worldarchitect@localhost:5432/worldarchitect';

  const admin = new Client({ connectionString: baseUrl, connectionTimeoutMillis: 2000 });
  try {
    await admin.connect();
  } catch (err) {
    if (REQUIRE_POSTGRES) throw err;
    logger.warn('postgresHarness.skipped', { reason: 'postgres unavailable', error: (err as Error).message });
    return null;
  }

  const originalEnv = {
    APP_MODE: process.env.APP_MODE,
    DATABASE_URL: process.env.DATABASE_URL,
    PROVIDER_SETTINGS_ENCRYPTION_KEY: process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY,
    ALLOW_DEV_AUTH_HEADER: process.env.ALLOW_DEV_AUTH_HEADER,
    NODE_ENV: process.env.NODE_ENV,
  };
  const databaseName = `worldarchitect_test_${prefix}_${nanoid(8)}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  const databaseUrl = withDatabaseName(baseUrl, databaseName);

  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } catch (err) {
    await admin.end();
    throw err;
  }

  const migrationClient = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await migrationClient.connect();
    await runPostgresMigrations(migrationClient);
  } catch (err) {
    await migrationClient.end().catch(() => undefined);
    await dropDatabase(admin, databaseName);
    await admin.end();
    throw err;
  }
  await migrationClient.end();

  process.env.NODE_ENV = 'test';
  process.env.APP_MODE = 'hosted';
  process.env.DATABASE_URL = databaseUrl;
  process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY = 'test-postgres-provider-settings-key';
  process.env.ALLOW_DEV_AUTH_HEADER = '1';
  resetDbClientForTests();
  await closePgPool();

  return {
    databaseName,
    databaseUrl,
    cleanup: async () => {
      await closePgPool();
      resetDbClientForTests();
      try {
        await dropDatabase(admin, databaseName);
      } finally {
        await admin.end();
        restoreEnv(originalEnv);
      }
    },
  };
}

function withDatabaseName(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  url.search = '';
  return url.toString();
}

async function dropDatabase(admin: pg.Client, databaseName: string): Promise<void> {
  await admin.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
}

function restoreEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
