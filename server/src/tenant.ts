import type { Request } from 'express';
import { getDbClient } from './db/client.js';
import { getAppMode, LOCAL_USER_ID } from './config.js';
import { getRequestUserId } from './auth.js';
import { asyncHandler } from './middleware/errorHandler.js';

export function tenantIdFor(req: Request): string {
  return getAppMode() === 'hosted' ? getRequestUserId(req) : LOCAL_USER_ID;
}

export async function worldBelongsToTenant(worldId: string, ownerId: string): Promise<boolean> {
  const row = await getDbClient().get('SELECT id FROM worlds WHERE id = ? AND owner_id = ?', [worldId, ownerId]);
  return !!row;
}

export const requireWorldTenant = asyncHandler(async (req, res, next) => {
  const wid = (req.params as Record<string, string>).wid;
  if (!wid) {
    next();
    return;
  }

  if (!(await worldBelongsToTenant(wid, tenantIdFor(req)))) {
    res.status(404).json({ error: 'World not found', code: 'NOT_FOUND' });
    return;
  }

  next();
});
