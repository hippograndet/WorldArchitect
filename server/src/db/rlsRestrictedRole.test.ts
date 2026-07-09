import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { nanoid } from 'nanoid';
import { setupPostgresTestHarness, type PostgresTestHarness } from '../test/postgresHarness.js';
import { resetDbClientForTests } from './client.js';
import { closePgPool } from './pgPool.js';
import { runStartupTasks } from '../startup.js';
import { getCheckpointer, resetCheckpointerForTests } from '../agents/checkpointer.js';

const { Client } = pg;
const REQUIRE_POSTGRES = process.env.CI === 'true';

let harness: PostgresTestHarness | null = null;
const roleNames: string[] = [];

beforeAll(async () => {
  harness = await setupPostgresTestHarness('rls_restricted');
});

afterAll(async () => {
  if (harness && roleNames.length > 0) {
    const admin = new Client({ connectionString: harness.databaseUrl, connectionTimeoutMillis: 2000 });
    try {
      await admin.connect();
      for (const roleName of roleNames) {
        await admin.query(`DROP OWNED BY ${quoteIdent(roleName)}`);
        await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(roleName)}`);
      }
    } finally {
      await admin.end().catch(() => undefined);
    }
  }
  await harness?.cleanup();
});

describe('Postgres RLS with a restricted app role', () => {
  it('blocks cross-tenant direct SQL and fails safely without tenant context', async ({ skip }) => {
    if (!harness) {
      skip();
      return;
    }

    const password = `pw_${nanoid(16)}`;
    const roleName = `worldarchitect_app_test_${nanoid(8)}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    let adminRoleBypassesRls = false;

    await getCheckpointer();

    const admin = new Client({ connectionString: harness.databaseUrl, connectionTimeoutMillis: 2000 });
    try {
      await admin.connect();
      const adminRole = await admin.query<{ bypasses_rls: boolean }>(
        `SELECT (rolsuper OR rolbypassrls) AS bypasses_rls
         FROM pg_roles
         WHERE rolname = current_user`,
      );
      adminRoleBypassesRls = adminRole.rows[0]?.bypasses_rls === true;
      try {
        await createRestrictedRole(admin, roleName, password, harness.databaseName);
      } catch (err) {
        if (!REQUIRE_POSTGRES && isInsufficientPrivilege(err)) {
          skip();
          return;
        }
        throw err;
      }
      roleNames.push(roleName);
      await seedTenants(admin);
      await seedRunsAndCheckpoints(admin);
    } finally {
      await admin.end().catch(() => undefined);
    }

    const app = new Client({ connectionString: withRoleCredentials(harness.databaseUrl, roleName, password), connectionTimeoutMillis: 2000 });
    try {
      await app.connect();

      const role = await app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(role.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });

      const missingTenantRows = await app.query(`SELECT id FROM worlds ORDER BY id`);
      expect(missingTenantRows.rows).toEqual([]);

      await expect(app.query(
        `INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
         VALUES ('missing-tenant-forged', 'user-a', 'Forged', 'forged', '[]', 'narrative', '{}', 0, 0)`,
      )).rejects.toThrow(/row-level security|violates/i);

      await app.query(`SELECT set_config('app.current_owner_id', $1, false)`, ['user-b']);

      const visibleToB = await app.query<{ id: string }>(`SELECT id FROM worlds ORDER BY id`);
      expect(visibleToB.rows.map((row) => row.id)).toEqual(['rls-world-b']);

      const directA = await app.query(`SELECT id FROM worlds WHERE id = 'rls-world-a'`);
      expect(directA.rows).toEqual([]);

      await expect(app.query(
        `INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
         VALUES ('forged-user-a-world', 'user-a', 'Forged', 'forged', '[]', 'narrative', '{}', 0, 0)`,
      )).rejects.toThrow(/row-level security|violates/i);

      await expect(app.query(
        `UPDATE worlds SET owner_id = 'user-a' WHERE id = 'rls-world-b'`,
      )).rejects.toThrow(/row-level security|violates/i);

      const updateA = await app.query(`UPDATE worlds SET name = 'Pwned' WHERE id = 'rls-world-a'`);
      expect(updateA.rowCount).toBe(0);

      const checkpointTables = await app.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = ANY($1)
         ORDER BY c.relname`,
        [['checkpoint_blobs', 'checkpoint_writes', 'checkpoints', 'llm_traces', 'run_review_items']],
      );
      expect(checkpointTables.rows).toHaveLength(5);
      expect(checkpointTables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

      const visibleCheckpoints = await app.query<{ thread_id: string }>(`SELECT thread_id FROM checkpoints ORDER BY thread_id`);
      expect(visibleCheckpoints.rows.map((row) => row.thread_id)).toEqual(['rls-run-b']);

      await expect(app.query(
        `INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)
         VALUES ('rls-run-a', '', 'forged-checkpoint', '{}', '{}')`,
      )).rejects.toThrow(/row-level security|violates/i);

      const tracesToB = await app.query<{ id: string }>(`SELECT id FROM llm_traces ORDER BY id`);
      expect(tracesToB.rows.map((row) => row.id)).toEqual(['trace-b']);

      await expect(app.query(
        `INSERT INTO llm_traces
           (id, owner_id, world_id, run_id, article_id, agent_type, provider, iteration, status,
            request_json, created_at)
         VALUES ('forged-trace-a', 'user-a', 'rls-world-a', 'rls-run-a', NULL, 'lorekeeper', 'groq', 1, 'error', '{}', 0)`,
      )).rejects.toThrow(/row-level security|violates/i);

      const reviewsToB = await app.query<{ id: string }>(`SELECT id FROM run_review_items ORDER BY id`);
      expect(reviewsToB.rows.map((row) => row.id)).toEqual(['review-b']);

      await expect(app.query(
        `INSERT INTO run_review_items
           (id, owner_id, world_id, run_id, article_id, step, kind, status, payload_json, created_at, updated_at)
         VALUES ('forged-review-a', 'user-a', 'rls-world-a', 'rls-run-a', NULL, 'Inception', 'intro_review', 'pending', '{}', 0, 0)`,
      )).rejects.toThrow(/row-level security|violates/i);
    } finally {
      await app.end().catch(() => undefined);
    }

    const restrictedUrl = withRoleCredentials(harness.databaseUrl, roleName, password);
    await withDatabaseEnv({
      APP_MODE: 'hosted',
      DATABASE_URL: restrictedUrl,
      MIGRATION_DATABASE_URL: harness.databaseUrl,
      ALLOW_DEV_AUTH_HEADER: undefined,
    }, async () => {
      await expect(runStartupTasks()).resolves.toBeUndefined();
    });

    if (adminRoleBypassesRls) {
      await withDatabaseEnv({
        APP_MODE: 'hosted',
        DATABASE_URL: harness.databaseUrl,
        MIGRATION_DATABASE_URL: harness.databaseUrl,
        ALLOW_DEV_AUTH_HEADER: undefined,
      }, async () => {
        await expect(runStartupTasks()).rejects.toThrow(/restricted Postgres role/i);
      });
    }
  }, 20000);
});

async function createRestrictedRole(admin: pg.Client, role: string, password: string, databaseName: string): Promise<void> {
  await admin.query(`
    CREATE ROLE ${quoteIdent(role)}
    LOGIN PASSWORD ${quoteLiteral(password)}
    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
  `);
  await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdent(databaseName)} TO ${quoteIdent(role)}`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(role)}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdent(role)}`);
  await admin.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(role)}`);
  await admin.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${quoteIdent(role)}`);
}

async function seedTenants(admin: pg.Client): Promise<void> {
  await admin.query(`
    INSERT INTO worlds (id, owner_id, name, description, tags, tone, style_config, created_at, updated_at)
    VALUES
      ('rls-world-a', 'user-a', 'A', 'world a', '[]', 'narrative', '{}', 0, 0),
      ('rls-world-b', 'user-b', 'B', 'world b', '[]', 'narrative', '{}', 0, 0)
  `);
}

async function seedRunsAndCheckpoints(admin: pg.Client): Promise<void> {
  await admin.query(`
    INSERT INTO runs
      (id, owner_id, world_id, status, graph_type, checkpoint_id, article_ids, budget_used, budget_limit, created_at, updated_at)
    VALUES
      ('rls-run-a', 'user-a', 'rls-world-a', 'paused', 'forge', 'rls-run-a', '[]', 0, 100, 0, 0),
      ('rls-run-b', 'user-b', 'rls-world-b', 'paused', 'forge', 'rls-run-b', '[]', 0, 100, 0, 0)
  `);
  await admin.query(`
    INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)
    VALUES
      ('rls-run-a', '', 'checkpoint-a', '{}', '{}'),
      ('rls-run-b', '', 'checkpoint-b', '{}', '{}')
  `);
  await admin.query(`
    INSERT INTO checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob)
    VALUES
      ('rls-run-a', '', 'owner', '1', 'json', NULL),
      ('rls-run-b', '', 'owner', '1', 'json', NULL)
  `);
  await admin.query(`
    INSERT INTO checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
    VALUES
      ('rls-run-a', '', 'checkpoint-a', 'task-a', 0, 'owner', 'json', '\\x7b7d'),
      ('rls-run-b', '', 'checkpoint-b', 'task-b', 0, 'owner', 'json', '\\x7b7d')
  `);
  await admin.query(`
    INSERT INTO llm_traces
      (id, owner_id, world_id, run_id, article_id, agent_type, provider, iteration, status, request_json, created_at)
    VALUES
      ('trace-a', 'user-a', 'rls-world-a', 'rls-run-a', NULL, 'lorekeeper', 'groq', 1, 'error', '{}', 0),
      ('trace-b', 'user-b', 'rls-world-b', 'rls-run-b', NULL, 'lorekeeper', 'groq', 1, 'success', '{}', 0)
  `);
  await admin.query(`
    INSERT INTO run_review_items
      (id, owner_id, world_id, run_id, article_id, step, kind, status, payload_json, created_at, updated_at)
    VALUES
      ('review-a', 'user-a', 'rls-world-a', 'rls-run-a', NULL, 'Inception', 'intro_review', 'pending', '{}', 0, 0),
      ('review-b', 'user-b', 'rls-world-b', 'rls-run-b', NULL, 'Inception', 'intro_review', 'pending', '{}', 0, 0)
  `);
}

function withRoleCredentials(databaseUrl: string, user: string, password: string): string {
  const url = new URL(databaseUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

function isInsufficientPrivilege(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '42501';
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function withDatabaseEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const previous = {
    APP_MODE: process.env.APP_MODE,
    DATABASE_URL: process.env.DATABASE_URL,
    MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
    ALLOW_DEV_AUTH_HEADER: process.env.ALLOW_DEV_AUTH_HEADER,
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetDbClientForTests();
  await closePgPool();
  resetCheckpointerForTests();

  try {
    await fn();
  } finally {
    await closePgPool();
    resetDbClientForTests();
    resetCheckpointerForTests();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
