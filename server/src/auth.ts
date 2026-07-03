import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { getAppMode, LOCAL_USER_ID } from './config.js';

let jwks: JWTVerifyGetKey | null = null;

function getJwks(): JWTVerifyGetKey {
  const url = process.env.CLERK_JWKS_URL;
  if (!url) throw new Error('CLERK_JWKS_URL is required in hosted mode');
  if (!jwks) jwks = createRemoteJWKSet(new URL(url));
  return jwks;
}

async function verifyClerkJwt(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, getJwks(), {
    algorithms: ['RS256'],
    ...(process.env.CLERK_ISSUER ? { issuer: process.env.CLERK_ISSUER } : {}),
    ...(process.env.CLERK_AUDIENCE ? { audience: process.env.CLERK_AUDIENCE } : {}),
  });
  if (!payload.sub) throw new Error('Token is missing subject');
  return payload.sub;
}

export function getRequestUserId(req: Request): string {
  return req.auth?.userId ?? LOCAL_USER_ID;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (getAppMode() === 'local') {
    req.auth = { userId: LOCAL_USER_ID };
    next();
    return;
  }

  const devUser = req.header('x-worldarchitect-user-id');
  if (process.env.ALLOW_DEV_AUTH_HEADER === '1' && devUser) {
    req.auth = { userId: devUser };
    next();
    return;
  }

  const authorization = req.header('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    return;
  }

  try {
    req.auth = { userId: await verifyClerkJwt(match[1]) };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid authentication token', code: 'AUTH_INVALID' });
  }
}

export function requireHostedMutationAuth(req: Request, res: Response, next: NextFunction): void {
  if (getAppMode() === 'hosted' && !req.auth?.userId) {
    res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    return;
  }
  next();
}
