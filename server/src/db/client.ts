import { getStorageDriver } from '../config.js';
import type { QueryExecutor } from './executor.js';
import { SqliteQueryExecutor } from './sqliteExecutor.js';
import { PostgresQueryExecutor } from './postgresExecutor.js';

let instance: QueryExecutor | null = null;

export function getDbClient(): QueryExecutor {
  if (!instance) {
    instance = getStorageDriver() === 'postgres' ? new PostgresQueryExecutor() : new SqliteQueryExecutor();
  }
  return instance;
}
