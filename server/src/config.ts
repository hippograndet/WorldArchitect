export const LOCAL_USER_ID = 'local-user';

export type AppMode = 'local' | 'hosted';
export type StorageDriver = 'sqlite' | 'postgres';

export function getAppMode(): AppMode {
  return process.env.APP_MODE === 'hosted' ? 'hosted' : 'local';
}

export function isHostedMode(): boolean {
  return getAppMode() === 'hosted';
}

export function getPublicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';
}

export function getStorageDriver(): StorageDriver {
  if (process.env.STORAGE_DRIVER === 'postgres') return 'postgres';
  return 'sqlite';
}

// Local mode is a single trusted desktop user (including Forge's recursive
// expansion, which can legitimately fire many requests quickly) — never
// throttle it. Only hosted mode faces untrusted multi-tenant traffic.
export function isRateLimitEnabled(): boolean {
  return isHostedMode();
}

export function getRateLimitConfig(): { windowMs: number; max: number } {
  return {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
  };
}

// Conservative vs. pg's own default (10) — Neon's pooler endpoint already
// multiplexes many app-side connections onto few real Postgres backends, so
// each server instance doesn't need a large local pool. Tune PGPOOL_MAX
// against (Neon plan's pooled connection limit) / (max concurrent instances).
export function getPgPoolConfig(): { max: number; idleTimeoutMillis: number; connectionTimeoutMillis: number } {
  return {
    max: Number(process.env.PGPOOL_MAX ?? 5),
    idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PGPOOL_CONN_TIMEOUT_MS ?? 5_000),
  };
}
