import type pg from 'pg';
import { getPgPool } from './pgPool.js';
import { translatePlaceholders, type QueryExecutor } from './executor.js';

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export class PostgresQueryExecutor implements QueryExecutor {
  constructor(private readonly client: Queryable = getPgPool()) {}

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.query(translatePlaceholders(sql), params);
    return result.rows as T[];
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.client.query(translatePlaceholders(sql), params);
    return result.rows[0] as T | undefined;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    const result = await this.client.query(translatePlaceholders(sql), params);
    return { changes: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
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
}
