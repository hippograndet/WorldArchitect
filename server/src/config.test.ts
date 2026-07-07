import { afterEach, describe, expect, it } from 'vitest';
import { getAppMode, getPublicBaseUrl } from './config.js';

const originalEnv = {
  APP_MODE: process.env.APP_MODE,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
};

afterEach(() => {
  restoreEnv();
});

describe('getAppMode', () => {
  it('defaults to local mode', () => {
    delete process.env.APP_MODE;

    expect(getAppMode()).toBe('local');
  });

  it('uses hosted mode when explicitly configured', () => {
    process.env.APP_MODE = 'hosted';

    expect(getAppMode()).toBe('hosted');
  });
});

describe('getPublicBaseUrl', () => {
  it('uses the local client URL by default', () => {
    delete process.env.PUBLIC_BASE_URL;

    expect(getPublicBaseUrl()).toBe('http://localhost:5173');
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
