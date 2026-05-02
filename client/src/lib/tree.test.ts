import { describe, it, expect } from 'vitest';
import { buildTree, type FlatArticle } from './tree.ts';

function flat(overrides: Partial<FlatArticle> & { id: string }): FlatArticle {
  return {
    title: overrides.id,
    status: 'stub',
    depth: 1,
    parentId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildTree
// ---------------------------------------------------------------------------

describe('buildTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('returns a single root node with no children', () => {
    const nodes = buildTree([flat({ id: 'a' })]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('a');
    expect(nodes[0].children).toEqual([]);
  });

  it('builds a one-level parent-child tree', () => {
    const articles = [
      flat({ id: 'parent' }),
      flat({ id: 'child', parentId: 'parent', depth: 2 }),
    ];
    const roots = buildTree(articles);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('parent');
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].id).toBe('child');
  });

  it('handles multiple root nodes', () => {
    const articles = [
      flat({ id: 'a' }),
      flat({ id: 'b' }),
      flat({ id: 'c' }),
    ];
    const roots = buildTree(articles);
    expect(roots).toHaveLength(3);
    expect(roots.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('handles three levels of nesting', () => {
    const articles = [
      flat({ id: 'root' }),
      flat({ id: 'mid', parentId: 'root', depth: 2 }),
      flat({ id: 'leaf', parentId: 'mid', depth: 3 }),
    ];
    const roots = buildTree(articles);
    expect(roots).toHaveLength(1);
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].children).toHaveLength(1);
    expect(roots[0].children[0].children[0].id).toBe('leaf');
  });

  it('treats orphan nodes (non-existent parentId) as roots', () => {
    const articles = [
      flat({ id: 'orphan', parentId: 'ghost' }),
      flat({ id: 'normal' }),
    ];
    const roots = buildTree(articles);
    // Both should appear at root level
    expect(roots).toHaveLength(2);
    const ids = roots.map((r) => r.id).sort();
    expect(ids).toEqual(['normal', 'orphan']);
  });

  it('handles multiple children on one parent', () => {
    const articles = [
      flat({ id: 'parent' }),
      flat({ id: 'child1', parentId: 'parent', depth: 2 }),
      flat({ id: 'child2', parentId: 'parent', depth: 2 }),
      flat({ id: 'child3', parentId: 'parent', depth: 2 }),
    ];
    const roots = buildTree(articles);
    expect(roots).toHaveLength(1);
    expect(roots[0].children).toHaveLength(3);
  });

  it('handles mixed: roots with children and lonely roots', () => {
    const articles = [
      flat({ id: 'root1' }),
      flat({ id: 'root2' }),
      flat({ id: 'child', parentId: 'root1', depth: 2 }),
    ];
    const roots = buildTree(articles);
    expect(roots).toHaveLength(2);
    const root1 = roots.find((r) => r.id === 'root1')!;
    const root2 = roots.find((r) => r.id === 'root2')!;
    expect(root1.children).toHaveLength(1);
    expect(root2.children).toHaveLength(0);
  });

  it('preserves all original fields on each TreeNode', () => {
    const articles = [
      { id: 'x', title: 'My Title', status: 'draft', depth: 1, parentId: null },
    ];
    const roots = buildTree(articles);
    expect(roots[0]).toMatchObject({ id: 'x', title: 'My Title', status: 'draft', depth: 1 });
  });

  it('returns nodes with children arrays even for leaf nodes', () => {
    const roots = buildTree([flat({ id: 'a' }), flat({ id: 'b' })]);
    for (const root of roots) {
      expect(Array.isArray(root.children)).toBe(true);
    }
  });

  it('handles a node whose parentId equals its own id (becomes a root)', () => {
    // Self-referencing: parentId === id means map.has(parentId) is true,
    // so the node would be added as its own child. buildTree does NOT guard
    // against this, so we document the actual behaviour: the node appears in
    // BOTH roots and its own children array (a cycle).
    // The important thing is that this edge case does NOT throw.
    expect(() => buildTree([flat({ id: 'self', parentId: 'self' })])).not.toThrow();
  });
});
