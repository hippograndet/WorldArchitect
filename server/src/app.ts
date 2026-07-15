import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { getPublicBaseUrl } from './config.js';
import { authMiddleware } from './auth.js';
import { requestContextMiddleware } from './requestContext.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorMiddleware } from './middleware/errorHandler.js';
import { registerRoutes } from './routes/index.js';

export function createApp(): express.Express {
  const app = express();

  // First in the chain so even pre-auth/malformed requests get a correlatable id.
  app.use(requestIdMiddleware);

  // Required for correct req.ip (and thus correct rate-limit keying) behind a
  // reverse proxy (Render sits in front of the app).
  app.set('trust proxy', process.env.TRUST_PROXY ?? 1);

  // CSP is disabled only for the optional same-process STATIC_DIR SPA-fallback
  // path (a bundled index.html), since the normal hosted deploy serves the
  // client from a separate origin and default CSP has nothing to conflict with.
  app.use(helmet({ contentSecurityPolicy: process.env.STATIC_DIR ? false : undefined }));

  app.use(express.json({ limit: '2mb' }));

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', getPublicBaseUrl());
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-worldarchitect-user-id');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use('/api', apiRateLimiter);

  app.use('/api', (req, res, next) => {
    void authMiddleware(req, res, next);
  });
  app.use('/api', requestContextMiddleware);

  registerRoutes(app);
  registerStaticRoutes(app);

  app.use(errorMiddleware);

  return app;
}

function registerStaticRoutes(app: express.Express): void {
  const staticDir = process.env.STATIC_DIR;
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/health') {
        next();
        return;
      }
      res.sendFile(resolve(staticDir, 'index.html'));
    });
  }
}
