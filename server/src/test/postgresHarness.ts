import pg from 'pg';
import { nanoid } from 'nanoid';
import { closePgPool } from '../db/pgPool.js';
import { resetDbClientForTests } from '../db/client.js';
import { runPostgresMigrations } from '../db/storage.js';
import { logger } from '../observability/logger.js';

const { Client } = pg;
const REQUIRE_POSTGRES = process.env.CI === 'true';

export interface PostgresTestHarness {
  schemaName: string;
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
    STORAGE_DRIVER: process.env.STORAGE_DRIVER,
    DATABASE_URL: process.env.DATABASE_URL,
    PROVIDER_SETTINGS_ENCRYPTION_KEY: process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY,
    ALLOW_DEV_AUTH_HEADER: process.env.ALLOW_DEV_AUTH_HEADER,
    NODE_ENV: process.env.NODE_ENV,
  };
  const schemaName = `${prefix}_${nanoid(8)}`;

  try {
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}", public`);
    await runPostgresMigrations(admin);
  } catch (err) {
    await admin.end();
    throw err;
  }

  const databaseUrl = withSearchPath(baseUrl, schemaName);
  process.env.NODE_ENV = 'test';
  process.env.APP_MODE = 'hosted';
  process.env.STORAGE_DRIVER = 'postgres';
  process.env.DATABASE_URL = databaseUrl;
  process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY = 'test-postgres-provider-settings-key';
  process.env.ALLOW_DEV_AUTH_HEADER = '1';
  resetDbClientForTests();
  await closePgPool();

  return {
    schemaName,
    databaseUrl,
    cleanup: async () => {
      await closePgPool();
      resetDbClientForTests();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await admin.query('DISCARD ALL');
      } finally {
        await admin.end();
        restoreEnv(originalEnv);
      }
    },
  };
}

function withSearchPath(baseUrl: string, schemaName: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${schemaName},public`);
  return url.toString();
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
