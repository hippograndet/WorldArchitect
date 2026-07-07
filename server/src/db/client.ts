import type { QueryExecutor } from './executor.js';
import { PostgresQueryExecutor } from './postgresExecutor.js';

let instance: QueryExecutor | null = null;

export function getDbClient(): QueryExecutor {
  if (!instance) {
    instance = new PostgresQueryExecutor();
  }
  return instance;
}

export function resetDbClientForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetDbClientForTests may only be used in tests');
  }
  instance = null;
}
