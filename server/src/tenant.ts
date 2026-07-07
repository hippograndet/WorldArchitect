import type { Request } from 'express';
import { getDbClient } from './db/client.js';
import { getAppMode, LOCAL_USER_ID } from './config.js';
import { getRequestUserId } from './auth.js';
import { asyncHandler } from './middleware/errorHandler.js';

export type TenantContext = {
  ownerId: string;
  worldId?: string;
};

export function tenantIdFor(req: Request): string {
  return getAppMode() === 'hosted' ? getRequestUserId(req) : LOCAL_USER_ID;
}

export function getTenantContext(req: Request): TenantContext {
  return req.tenant ?? { ownerId: tenantIdFor(req) };
}

export function requireTenantContext(req: Request): Required<TenantContext> {
  if (req.tenant?.worldId) {
    return { ownerId: req.tenant.ownerId, worldId: req.tenant.worldId };
  }

  const wid = (req.params as Record<string, string | undefined>).wid;
  if (!wid || getAppMode() === 'hosted') {
    throw new Error('Tenant context is required for this world-scoped route');
  }

  const context = { ownerId: tenantIdFor(req), worldId: wid };
  req.tenant = context;
  return context;
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

  const ownerId = tenantIdFor(req);
  if (!(await worldBelongsToTenant(wid, ownerId))) {
    res.status(404).json({ error: 'World not found', code: 'NOT_FOUND' });
    return;
  }

  req.tenant = { ownerId, worldId: wid };
  next();
});
