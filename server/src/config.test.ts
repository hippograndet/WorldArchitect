import { afterEach, describe, expect, it } from 'vitest';
import { getStorageDriver } from './config.js';

const originalEnv = {
  STORAGE_DRIVER: process.env.STORAGE_DRIVER,
  DATABASE_URL: process.env.DATABASE_URL,
};

afterEach(() => {
  restoreEnv();
});

describe('getStorageDriver', () => {
  it('uses explicit Postgres storage', () => {
    process.env.STORAGE_DRIVER = 'postgres';
    delete process.env.DATABASE_URL;

    expect(getStorageDriver()).toBe('postgres');
  });

  it('keeps SQLite as an explicit legacy override', () => {
    process.env.STORAGE_DRIVER = 'sqlite';
    process.env.DATABASE_URL = 'postgres://worldarchitect:worldarchitect@localhost:5432/worldarchitect';

    expect(getStorageDriver()).toBe('sqlite');
  });

  it('prefers Postgres when DATABASE_URL is configured', () => {
    delete process.env.STORAGE_DRIVER;
    process.env.DATABASE_URL = 'postgres://worldarchitect:worldarchitect@localhost:5432/worldarchitect';

    expect(getStorageDriver()).toBe('postgres');
  });

  it('falls back to SQLite only when no Postgres configuration is present', () => {
    delete process.env.STORAGE_DRIVER;
    delete process.env.DATABASE_URL;

    expect(getStorageDriver()).toBe('sqlite');
  });
});

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
