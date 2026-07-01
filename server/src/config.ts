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
