import { createPublicKey, verify } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { getAppMode, LOCAL_USER_ID } from './config.js';

type JwksKey = {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
};

type JwtPayload = {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
};

let jwksCache: { keys: JwksKey[]; fetchedAt: number } | null = null;

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseJwt(token: string): { header: Record<string, unknown>; payload: JwtPayload; signed: string; signature: Buffer } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid bearer token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  return {
    header: JSON.parse(base64UrlDecode(encodedHeader).toString('utf8')) as Record<string, unknown>,
    payload: JSON.parse(base64UrlDecode(encodedPayload).toString('utf8')) as JwtPayload,
    signed: `${encodedHeader}.${encodedPayload}`,
    signature: base64UrlDecode(encodedSignature),
  };
}

async function getJwks(): Promise<JwksKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 5 * 60 * 1000) return jwksCache.keys;
  const url = process.env.CLERK_JWKS_URL;
  if (!url) throw new Error('CLERK_JWKS_URL is required in hosted mode');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load JWKS: ${response.status}`);
  const data = await response.json() as { keys?: JwksKey[] };
  jwksCache = { keys: data.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

function assertPayload(payload: JwtPayload): string {
  if (!payload.sub) throw new Error('Token is missing subject');
  if (payload.exp && payload.exp * 1000 <= Date.now()) throw new Error('Token has expired');
  if (process.env.CLERK_ISSUER && payload.iss !== process.env.CLERK_ISSUER) {
    throw new Error('Token issuer mismatch');
  }
  if (process.env.CLERK_AUDIENCE) {
    const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (!aud.includes(process.env.CLERK_AUDIENCE)) throw new Error('Token audience mismatch');
  }
  return payload.sub;
}

async function verifyClerkJwt(token: string): Promise<string> {
  const parsed = parseJwt(token);
  if (parsed.header.alg !== 'RS256') throw new Error('Only RS256 bearer tokens are supported');
  const kid = parsed.header.kid as string | undefined;
  const keys = await getJwks();
  const key = keys.find((candidate) => candidate.kid === kid) ?? keys[0];
  if (!key) throw new Error('No JWKS signing key is available');

  const publicKey = createPublicKey({ key, format: 'jwk' });
  const ok = verify('RSA-SHA256', Buffer.from(parsed.signed), publicKey, parsed.signature);
  if (!ok) throw new Error('Invalid bearer token signature');
  return assertPayload(parsed.payload);
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
