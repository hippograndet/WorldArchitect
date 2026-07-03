import { nanoid } from 'nanoid';
import type { RequestHandler } from 'express';
import { contextStorage } from '../requestContext.js';

// Mounted first in the middleware chain (before helmet/CORS/auth) so every
// request — including pre-auth failures — gets a correlatable id.
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const requestId = req.header('x-request-id') || nanoid();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  contextStorage.run({ requestId }, next);
};
