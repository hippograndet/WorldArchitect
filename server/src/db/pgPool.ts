import pg from 'pg';
import { getPgPoolConfig } from '../config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * One pool for the process. `storage.ts` (health/migrate) and the query
 * executor both use this — a separate `new Pool()` per caller would open a
 * fresh connection set every time it's constructed instead of amortizing.
 */
export function getPgPool(): pg.Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, ...getPgPoolConfig() });
  return pool;
}
