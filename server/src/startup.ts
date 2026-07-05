import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { getStorageAdapter } from './db/storage.js';
import { assertNoCommittedSecrets } from './security/secretScan.js';

export async function runStartupTasks(): Promise<void> {
  assertNoCommittedSecrets();
  validateStaticDir();
  await getStorageAdapter().migrate();
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
