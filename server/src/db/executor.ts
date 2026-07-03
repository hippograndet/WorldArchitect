/**
 * Driver-agnostic async query interface. Both the SQLite and Postgres
 * implementations satisfy this so route/service code can be written once
 * and run against either backend.
 */
export interface QueryExecutor {
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;
  transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
}

/**
 * Every call site in this codebase writes `?` placeholders (better-sqlite3 style).
 * Postgres needs `$1, $2, ...`. Quoted string literals are skipped so a literal
 * `?` inside a string (none exist today, but stay defensive) isn't miscounted.
 */
export function translatePlaceholders(sql: string): string {
  let result = '';
  let paramIndex = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      inString = !inString;
      result += ch;
      continue;
    }
    if (ch === '?' && !inString) {
      paramIndex += 1;
      result += `$${paramIndex}`;
      continue;
    }
    result += ch;
  }
  return result;
}
