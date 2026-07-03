import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { translatePlaceholders } from './executor.js';
import { SqliteQueryExecutor } from './sqliteExecutor.js';

describe('translatePlaceholders', () => {
  it('translates sequential ? placeholders to $1, $2, ...', () => {
    expect(translatePlaceholders('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    );
  });

  it('handles a dynamic IN-clause placeholder list', () => {
    const placeholders = ['?', '?', '?'].join(', ');
    const sql = `SELECT * FROM t WHERE id IN (${placeholders})`;
    expect(translatePlaceholders(sql)).toBe('SELECT * FROM t WHERE id IN ($1, $2, $3)');
  });

  it('does not count a literal ? inside a quoted string literal', () => {
    expect(translatePlaceholders(`SELECT ? , 'literal?' , ?`)).toBe(`SELECT $1 , 'literal?' , $2`);
  });

  it('leaves SQL with no placeholders unchanged', () => {
    expect(translatePlaceholders('SELECT NOW()')).toBe('SELECT NOW()');
  });
});

describe('SqliteQueryExecutor', () => {
  let db: Database.Database;
  let exec: SqliteQueryExecutor;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0)`);
    exec = new SqliteQueryExecutor(db);
  });

  it('run/get/all round-trip through parameterized queries', async () => {
    await exec.run('INSERT INTO items (id, name, count) VALUES (?, ?, ?)', ['a', 'Alpha', 1]);
    await exec.run('INSERT INTO items (id, name, count) VALUES (?, ?, ?)', ['b', 'Beta', 2]);

    const one = await exec.get<{ name: string }>('SELECT name FROM items WHERE id = ?', ['a']);
    expect(one?.name).toBe('Alpha');

    const all = await exec.all<{ id: string }>('SELECT id FROM items ORDER BY id');
    expect(all.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('run() reports changes', async () => {
    await exec.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha']);
    const result = await exec.run('UPDATE items SET count = ? WHERE id = ?', [5, 'a']);
    expect(result.changes).toBe(1);
  });

  it('transaction() commits all writes on success', async () => {
    await exec.transaction(async (tx) => {
      await tx.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha']);
      await tx.run('INSERT INTO items (id, name) VALUES (?, ?)', ['b', 'Beta']);
    });

    const rows = await exec.all('SELECT id FROM items');
    expect(rows).toHaveLength(2);
  });

  it('transaction() rolls back all writes if the callback throws', async () => {
    await expect(
      exec.transaction(async (tx) => {
        await tx.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const rows = await exec.all('SELECT id FROM items');
    expect(rows).toHaveLength(0);
  });

  it('a nested getDb()-style call on the same connection joins the open transaction', async () => {
    // Regression check for the exact pattern worldBible.ts#upsertEntry relies on
    // pre-migration: a plain synchronous db.prepare().run() issued while a
    // transaction is open via this executor must be part of that transaction.
    await expect(
      exec.transaction(async () => {
        await exec.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha']);
        db.prepare('INSERT INTO items (id, name) VALUES (?, ?)').run('b', 'Beta');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const rows = await exec.all('SELECT id FROM items');
    expect(rows).toHaveLength(0);
  });
});
