import { describe, expect, it } from 'vitest';
import { ownerParams, ownerPredicate, worldOwnerParams, worldOwnerPredicate } from './tenantScope.js';

describe('tenant scope SQL helpers', () => {
  it('adds owner predicates only when an owner id is provided', () => {
    expect(ownerPredicate('a', 'user-a')).toBe(' AND a.owner_id = ?');
    expect(ownerParams('user-a')).toEqual(['user-a']);

    expect(ownerPredicate('a')).toBe('');
    expect(ownerParams()).toEqual([]);
  });

  it('keeps world and owner parameter order aligned with the generated predicate', () => {
    expect(worldOwnerPredicate('articles', 'user-a')).toBe('articles.world_id = ? AND articles.owner_id = ?');
    expect(worldOwnerParams('world-a', 'user-a')).toEqual(['world-a', 'user-a']);

    expect(worldOwnerPredicate('articles')).toBe('articles.world_id = ?');
    expect(worldOwnerParams('world-a')).toEqual(['world-a']);
  });
});
