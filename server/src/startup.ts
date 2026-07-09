import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { getAppMode } from './config.js';
import { getDbClient } from './db/client.js';
import { getStorageAdapter } from './db/storage.js';
import { assertNoCommittedSecrets } from './security/secretScan.js';

export async function runStartupTasks(): Promise<void> {
  assertNoCommittedSecrets();
  validateStaticDir();
  await getStorageAdapter().migrate();
  await validateRuntimeDatabaseRole();
}

function validateStaticDir(): void {
  const staticDir = process.env.STATIC_DIR;
  if (!staticDir) return;

  if (!existsSync(staticDir) || !statSync(staticDir).isDirectory()) {
    throw new Error(`STATIC_DIR does not exist or is not a directory: ${staticDir}`);
  }

  const indexPath = resolve(staticDir, 'index.html');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new Error(`STATIC_DIR is missing index.html: ${indexPath}`);
  }
}

async function validateRuntimeDatabaseRole(): Promise<void> {
  if (getAppMode() !== 'hosted') return;
  if (process.env.ALLOW_DEV_AUTH_HEADER === '1') return;

  const role = await getDbClient().get<{ current_user: string; bypasses_rls: boolean }>(
    `SELECT current_user, (rolsuper OR rolbypassrls) AS bypasses_rls
     FROM pg_roles
     WHERE rolname = current_user`,
  );

  if (role?.bypasses_rls) {
    throw new Error(
      `Hosted mode DATABASE_URL must use a restricted Postgres role without SUPERUSER or BYPASSRLS privileges. Current role "${role.current_user}" can bypass RLS.`,
    );
  }
}
