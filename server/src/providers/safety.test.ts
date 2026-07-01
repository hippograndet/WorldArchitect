import { describe, expect, it, vi } from 'vitest';
import { assertTokenBudget, ProviderSafetyError, runProviderRequest } from './safety.js';

describe('provider safety', () => {
  it('rejects requests above the hard token ceiling', () => {
    expect(() => assertTokenBudget(
      [{ role: 'user', content: 'x'.repeat(100) }],
      { maxTokens: 100, maxTotalTokens: 20 },
    )).toThrow(/token ceiling/);
  });

  it('retries provider failures with backoff', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('ok');

    await expect(runProviderRequest(fn, {
      timeoutMs: 1000,
      retry: { attempts: 2, baseDelayMs: 1 },
    })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns a typed timeout error', async () => {
    await expect(runProviderRequest(
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 20)),
      { timeoutMs: 1, retry: { attempts: 1, baseDelayMs: 1 } },
    )).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
  });

  it('returns a typed retry exhaustion error', async () => {
    await expect(runProviderRequest(
      () => Promise.reject(new Error('down')),
      { timeoutMs: 1000, retry: { attempts: 2, baseDelayMs: 1 } },
    )).rejects.toBeInstanceOf(ProviderSafetyError);
  });
});
