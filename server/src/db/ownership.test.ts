import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteQueryExecutor } from './sqliteExecutor.js';
import { ownerIdForWorld, ownerIdForArticle } from './ownership.js';

describe('ownership helpers', () => {
  let exec: SqliteQueryExecutor;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE worlds (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL);
      CREATE TABLE articles (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, world_id TEXT NOT NULL);
      INSERT INTO worlds (id, owner_id) VALUES ('w1', 'user-1');
      INSERT INTO articles (id, owner_id, world_id) VALUES ('a1', 'user-1', 'w1');
    `);
    exec = new SqliteQueryExecutor(db);
  });

  it('looks up the owning user id of a world', async () => {
    await expect(ownerIdForWorld(exec, 'w1')).resolves.toBe('user-1');
  });

  it('looks up the owning user id of an article via its world', async () => {
    await expect(ownerIdForArticle(exec, 'a1')).resolves.toBe('user-1');
  });

  it('throws if the world does not exist', async () => {
    await expect(ownerIdForWorld(exec, 'missing')).rejects.toThrow('World missing not found');
  });

  it('throws if the article does not exist', async () => {
    await expect(ownerIdForArticle(exec, 'missing')).rejects.toThrow('Article missing not found');
  });
});
