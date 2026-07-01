import { AsyncLocalStorage } from 'async_hooks';
import type { RequestHandler } from 'express';
import { getRequestUserId } from './auth.js';

const storage = new AsyncLocalStorage<{ userId: string }>();

export const requestContextMiddleware: RequestHandler = (req, _res, next) => {
  storage.run({ userId: getRequestUserId(req) }, next);
};

export function getContextUserId(): string | undefined {
  return storage.getStore()?.userId;
}
