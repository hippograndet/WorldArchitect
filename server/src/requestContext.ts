import { AsyncLocalStorage } from 'async_hooks';
import type { RequestHandler } from 'express';
import { getRequestUserId } from './auth.js';

export const contextStorage = new AsyncLocalStorage<{ requestId?: string; userId?: string }>();

// Merges into whatever context requestIdMiddleware already established,
// rather than overwriting it — this runs later in the chain (after auth)
// and must not drop the requestId set upstream.
export const requestContextMiddleware: RequestHandler = (req, _res, next) => {
  const existing = contextStorage.getStore() ?? {};
  contextStorage.run({ ...existing, userId: getRequestUserId(req) }, next);
};

export function getContextUserId(): string | undefined {
  return contextStorage.getStore()?.userId;
}

export function getContextRequestId(): string | undefined {
  return contextStorage.getStore()?.requestId;
}
