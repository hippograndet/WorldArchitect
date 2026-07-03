import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { generateKeyPair, exportJWK, SignJWT, type JWK, type JWTHeaderParameters } from 'jose';

const JWKS_URL = 'https://auth.test.local/.well-known/jwks.json';
const ISSUER = 'https://auth.test.local';
const AUDIENCE = 'test-audience';

process.env.APP_MODE = 'hosted';
process.env.CLERK_JWKS_URL = JWKS_URL;
process.env.CLERK_ISSUER = ISSUER;
process.env.CLERK_AUDIENCE = AUDIENCE;
delete process.env.ALLOW_DEV_AUTH_HEADER;

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    if (url.toString() === JWKS_URL) {
      return new Response(
        JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Imported after env vars are set above, since authMiddleware reads
// process.env.CLERK_* lazily at call time — order doesn't matter here, but
// keeping the import after setup makes that explicit.
const { authMiddleware } = await import('./auth.js');

const app = express();
app.use((req, res, next) => {
  void authMiddleware(req, res, next);
});
app.get('/whoami', (req, res) => {
  res.json({ userId: req.auth?.userId });
});
const req = supertest(app);

async function signToken(overrides: Partial<{
  alg: string;
  kid: string | undefined;
  issuer: string;
  audience: string;
  expiresIn: string;
  subject: string | undefined;
}> = {}): Promise<string> {
  const {
    alg = 'RS256',
    kid = 'test-key',
    issuer = ISSUER,
    audience = AUDIENCE,
    expiresIn = '5m',
    subject = 'user-1',
  } = overrides;

  const header: JWTHeaderParameters = { alg };
  if (kid) header.kid = kid;

  let jwt = new SignJWT({})
    .setProtectedHeader(header)
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresIn);
  if (subject) jwt = jwt.setSubject(subject);

  return jwt.sign(privateKey);
}

describe('authMiddleware (hosted mode, Clerk JWT verification)', () => {
  it('accepts a valid RS256 token and sets req.auth.userId from the subject', async () => {
    const token = await signToken();
    const res = await req.get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-1');
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ expiresIn: '-10s' });
    const res = await req.get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_INVALID');
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = await signToken({ issuer: 'https://not-clerk.example' });
    const res = await req.get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await signToken({ audience: 'someone-elses-app' });
    const res = await req.get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects an algorithm-confusion attempt (HS256 signed using the RSA public key bytes as an HMAC secret)', async () => {
    const hmacSecret = new TextEncoder().encode(JSON.stringify(publicJwk));
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(hmacSecret);

    const res = await req.get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await req.get('/whoami').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('rejects a request with no Authorization header', async () => {
    const res = await req.get('/whoami');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });
});
