import type Database from 'better-sqlite3';
import { getDb } from './index.js';
import type { QueryExecutor } from './executor.js';

/**
 * better-sqlite3's own `db.transaction(fn)` requires `fn` to run fully
 * synchronously — if it returns a Promise, the transaction commits after the
 * first `await` instead of waiting for the body to finish, silently breaking
 * atomicity. So transactions here are driven with explicit BEGIN/COMMIT/ROLLBACK
 * around an awaited async callback instead of using that wrapper. SQLite has a
 * single connection regardless, so any nested `getDb()` call elsewhere still
 * transparently joins this transaction.
 */
export class SqliteQueryExecutor implements QueryExecutor {
  constructor(private readonly db: Database.Database = getDb()) {}

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    const info = this.db.prepare(sql).run(...params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
