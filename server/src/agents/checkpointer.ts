import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type pg from 'pg';
import { getPgPool } from '../db/pgPool.js';
import { getContextUserId } from '../requestContext.js';

let instance: BaseCheckpointSaver | null = null;
let setupDone = false;
let tenantPool: TenantAwareCheckpointPool | null = null;

/**
 * One checkpointer per process, mirroring db/pgPool.ts's "one pool for the
 * process" rationale. PostgresSaver reuses the app's shared pool rather than
 * opening a second connection set.
 */
export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (instance && setupDone) return instance;

  const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
  tenantPool ??= new TenantAwareCheckpointPool(getPgPool());
  const saver = new PostgresSaver(tenantPool as unknown as pg.Pool);
  if (!(await checkpointSchemaReady())) {
    await saver.setup();
  }
  await ensureCheckpointRls();
  instance = saver;

  setupDone = true;
  return instance;
}

/**
 * LangGraph's PostgresSaver uses raw pg queries, outside PostgresQueryExecutor.
 * This adapter makes checkpoint reads/writes use the same request/background
 * tenant setting as normal app queries before any checkpoint SQL runs.
 */
class TenantAwareCheckpointPool {
  constructor(private readonly pool: pg.Pool) {}

  async connect(): Promise<pg.PoolClient> {
    const client = await this.pool.connect();
    try {
      await setSessionTenant(client);
      return client;
    } catch (err) {
      client.release();
      throw err;
    }
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    const client = await this.connect();
    try {
      return await client.query<T>(queryText, values);
    } finally {
      client.release();
    }
  }
}

async function setSessionTenant(client: Pick<pg.PoolClient, 'query'>): Promise<void> {
  await client.query(`SELECT set_config('app.current_owner_id', $1, false)`, [getContextUserId() ?? '']);
}

async function ensureCheckpointRls(): Promise<void> {
  const client = await getPgPool().connect();
  try {
    await client.query(`
      DO $$
      DECLARE
        table_name TEXT;
      BEGIN
        IF to_regclass('public.checkpoints') IS NULL
          OR to_regclass('public.checkpoint_blobs') IS NULL
          OR to_regclass('public.checkpoint_writes') IS NULL THEN
          RETURN;
        END IF;

        FOREACH table_name IN ARRAY ARRAY['checkpoints', 'checkpoint_blobs', 'checkpoint_writes']
        LOOP
          EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
          EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
          EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_' || table_name, table_name);
          EXECUTE format(
            'CREATE POLICY %I ON %I USING (EXISTS (SELECT 1 FROM runs WHERE runs.id = %I.thread_id AND runs.owner_id = app_current_owner_id())) WITH CHECK (EXISTS (SELECT 1 FROM runs WHERE runs.id = %I.thread_id AND runs.owner_id = app_current_owner_id()))',
            'tenant_' || table_name,
            table_name,
            table_name,
            table_name
          );
        END LOOP;
      END $$;
    `);
  } finally {
    client.release();
  }
}

async function checkpointSchemaReady(): Promise<boolean> {
  const client = await getPgPool().connect();
  try {
    const ready = await client.query<{ ready: boolean }>(`
      SELECT to_regclass('public.checkpoint_migrations') IS NOT NULL
         AND COALESCE((SELECT MAX(v) >= 4 FROM public.checkpoint_migrations), false) AS ready
    `);
    return ready.rows[0]?.ready === true;
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '42P01') return false;
    throw err;
  } finally {
    client.release();
  }
}

export function resetCheckpointerForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetCheckpointerForTests may only be used in tests');
  }
  instance = null;
  setupDone = false;
  tenantPool = null;
}
