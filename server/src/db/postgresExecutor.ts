import type pg from 'pg';
import { getPgPool } from './pgPool.js';
import { translatePlaceholders, type QueryExecutor } from './executor.js';
import { getContextUserId } from '../requestContext.js';

type Queryable = pg.Pool | pg.PoolClient;

export class PostgresQueryExecutor implements QueryExecutor {
  constructor(private readonly client: Queryable = getPgPool()) {}

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.query(sql, params);
    return result.rows as T[];
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.query(sql, params);
    return result.rows[0] as T | undefined;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    const result = await this.query(sql, params);
    return { changes: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setLocalTenant(client);
      const result = await fn(new PostgresQueryExecutor(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async query(sql: string, params: unknown[]): Promise<pg.QueryResult> {
    if (isPoolClient(this.client)) {
      return this.client.query(translatePlaceholders(sql), params);
    }

    const tenantId = getContextUserId();
    if (!tenantId) {
      return this.client.query(translatePlaceholders(sql), params);
    }

    const client = await this.client.connect();
    try {
      await client.query('BEGIN');
      await setLocalTenant(client, tenantId);
      const result = await client.query(translatePlaceholders(sql), params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

function isPoolClient(client: Queryable): client is pg.PoolClient {
  return 'release' in client;
}

async function setLocalTenant(client: Pick<pg.PoolClient, 'query'>, tenantId = getContextUserId()): Promise<void> {
  if (!tenantId) return;
  await client.query(`SELECT set_config('app.current_owner_id', $1, true)`, [tenantId]);
}
