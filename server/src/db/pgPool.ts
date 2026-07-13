import pg from 'pg';
import { getPgPoolConfig } from '../config.js';

const { Pool } = pg;

// OID 20 = int8/BIGINT. node-postgres returns these as strings by default to
// avoid silent precision loss for values that could exceed 2^53. Every BIGINT
// column in this schema is either an epoch-millisecond timestamp or a small
// counter (token/item counts) — both always well inside Number.MAX_SAFE_INTEGER
// — so parsing them as numbers here is safe, and fixes every service's
// timestamp/counter fields in one place instead of coercing in each row-mapper.
pg.types.setTypeParser(20, (val) => parseInt(val, 10));

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

export async function closePgPool(): Promise<void> {
  if (!pool) return;
  const poolToClose = pool;
  pool = null;
  await poolToClose.end();
}
