export const LOCAL_USER_ID = 'local-user';

export type AppMode = 'local' | 'hosted';

export function getAppMode(): AppMode {
  return process.env.APP_MODE === 'hosted' ? 'hosted' : 'local';
}

export function isHostedMode(): boolean {
  return getAppMode() === 'hosted';
}

export function getPublicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';
}
