import type { Request, RequestHandler } from 'express';
import { getDb } from './db/index.js';
import { getAppMode, LOCAL_USER_ID } from './config.js';
import { getRequestUserId } from './auth.js';

export function tenantIdFor(req: Request): string {
  return getAppMode() === 'hosted' ? getRequestUserId(req) : LOCAL_USER_ID;
}

export function worldBelongsToTenant(worldId: string, ownerId: string): boolean {
  return !!getDb()
    .prepare('SELECT id FROM worlds WHERE id = ? AND owner_id = ?')
    .get(worldId, ownerId);
}

export const requireWorldTenant: RequestHandler = (req, res, next) => {
  const wid = (req.params as Record<string, string>).wid;
  if (!wid) {
    next();
    return;
  }

  if (!worldBelongsToTenant(wid, tenantIdFor(req))) {
    res.status(404).json({ error: 'World not found', code: 'NOT_FOUND' });
    return;
  }

  next();
};
