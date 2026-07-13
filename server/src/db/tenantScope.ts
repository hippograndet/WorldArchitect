/**
 * Tiny SQL helpers for application-level tenant predicates.
 *
 * RLS is defense in depth; server code that touches tenant rows should still
 * carry explicit owner_id filters. These helpers keep the optional local-mode
 * fallback readable while making hosted-mode owner scoping hard to miss.
 */
export function ownerPredicate(alias: string, ownerId?: string): string {
  return ownerId ? ` AND ${alias}.owner_id = ?` : '';
}

export function ownerParams(ownerId?: string): unknown[] {
  return ownerId ? [ownerId] : [];
}

export function worldOwnerPredicate(alias: string, ownerId?: string): string {
  return `${alias}.world_id = ?${ownerPredicate(alias, ownerId)}`;
}

export function worldOwnerParams(worldId: string, ownerId?: string): unknown[] {
  return ownerId ? [worldId, ownerId] : [worldId];
}
