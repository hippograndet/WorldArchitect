import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import pg from 'pg';
import { nanoid } from 'nanoid';
import { applySchema, runMigrations } from './schema.js';
import { runPostgresMigrations } from './storage.js';
import { logger } from '../observability/logger.js';

const { Client } = pg;

const DATABASE_URL = process.env.DRIFT_TEST_DATABASE_URL
  ?? 'postgres://worldarchitect:worldarchitect@localhost:5432/worldarchitect';
const REQUIRE_POSTGRES = process.env.CI === 'true';

// Schema-mutating admin work (CREATE/DROP SCHEMA) belongs on a direct,
// unpooled connection, not a shared pooler endpoint — see "Pooled Postgres
// connections" in dev-docs/engineering/practices.md for why. This is advisory
// only: DISCARD ALL below still makes a pooled connection safe to use here.
if (/-pooler\./i.test(DATABASE_URL)) {
  logger.warn('schemaDrift.pooledConnectionWarning', {
    message: 'DRIFT_TEST_DATABASE_URL looks pooled (e.g. Neon\'s -pooler host). '
      + 'Prefer a direct/unpooled connection string for schema admin work.',
  });
}

type ColumnsByTable = Map<string, Set<string>>;

function getSqliteColumns(): ColumnsByTable {
  const db = new Database(':memory:');
  applySchema(db);
  runMigrations(db);

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];

  const result: ColumnsByTable = new Map();
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
    result.set(name, new Set(columns.map((c) => c.name)));
  }
  db.close();
  return result;
}

async function getPostgresColumns(client: pg.Client, schema: string): Promise<ColumnsByTable> {
  const res = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name != 'schema_migrations'`,
    [schema],
  );
  const result: ColumnsByTable = new Map();
  for (const row of res.rows) {
    if (!result.has(row.table_name)) result.set(row.table_name, new Set());
    result.get(row.table_name)!.add(row.column_name);
  }
  return result;
}

interface Drift {
  table: string;
  onlyInSqlite: string[];
  onlyInPostgres: string[];
}

// Compares column-NAME sets only, not full type equality: SQLite INTEGER
// timestamps vs Postgres BIGINT, and owner_id's SQLite default vs Postgres's
// no-default, are known intentional differences — not drift. What this
// guards against is a column added to one schema and forgotten in the other.
function diffColumnSets(sqlite: ColumnsByTable, postgres: ColumnsByTable): Drift[] {
  const drift: Drift[] = [];
  const sharedTables = [...sqlite.keys()].filter((t) => postgres.has(t));
  for (const table of sharedTables) {
    const sqliteCols = sqlite.get(table)!;
    const postgresCols = postgres.get(table)!;
    const onlyInSqlite = [...sqliteCols].filter((c) => !postgresCols.has(c)).sort();
    const onlyInPostgres = [...postgresCols].filter((c) => !sqliteCols.has(c)).sort();
    if (onlyInSqlite.length > 0 || onlyInPostgres.length > 0) {
      drift.push({ table, onlyInSqlite, onlyInPostgres });
    }
  }
  return drift;
}

describe('SQLite / Postgres schema drift', () => {
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
      logger.warn('schemaDrift.skipped', { reason: 'postgres unavailable', error: (err as Error).message });
      return;
    }
    schemaName = `drift_test_${nanoid(8)}`;
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    // Keep "public" in the path (not just the throwaway schema) — if this
    // connection is pooled (e.g. Neon's PgBouncer), a bare `SET search_path`
    // to only the throwaway schema can leak to the next session sharing that
    // pooled backend and break it once this schema is dropped.
    await client.query(`SET search_path TO "${schemaName}", public`);
    await runPostgresMigrations(client);
  });

  afterAll(async () => {
    if (!client) return;
    try {
      if (postgresAvailable && schemaName) {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
      // Reset all session state before releasing the connection, in case
      // it's pooled and reused by an unrelated session afterward.
      if (postgresAvailable) await client.query('DISCARD ALL');
    } finally {
      await client.end();
    }
  });

  it('has no column-name drift between the SQLite and Postgres schemas', async ({ skip }) => {
    if (!postgresAvailable) {
      skip();
      return;
    }

    const sqliteColumns = getSqliteColumns();
    const postgresColumns = await getPostgresColumns(client!, schemaName);

    const tablesOnlyInSqlite = [...sqliteColumns.keys()].filter((t) => !postgresColumns.has(t));
    const tablesOnlyInPostgres = [...postgresColumns.keys()].filter((t) => !sqliteColumns.has(t));
    if (tablesOnlyInSqlite.length > 0) logger.warn('schemaDrift.tableOnlyInSqlite', { tables: tablesOnlyInSqlite });
    if (tablesOnlyInPostgres.length > 0) logger.warn('schemaDrift.tableOnlyInPostgres', { tables: tablesOnlyInPostgres });

    const drift = diffColumnSets(sqliteColumns, postgresColumns);
    const message = drift
      .map((d) => `  ${d.table}: onlyInSqlite=[${d.onlyInSqlite.join(', ')}] onlyInPostgres=[${d.onlyInPostgres.join(', ')}]`)
      .join('\n');

    expect(drift, `Column drift detected between SQLite and Postgres schemas:\n${message}`).toEqual([]);
  });
});
