import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { applySchema } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../../data');
const DB_PATH = resolve(DATA_DIR, 'worldarchitect.db');

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  instance = new Database(DB_PATH);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  applySchema(instance);

  return instance;
}

export { DB_PATH };
