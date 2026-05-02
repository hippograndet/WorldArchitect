export interface FlatArticle {
  id: string;
  title: string;
  status: string;
  depth: number;
  parentId: string | null;
}

export interface TreeNode extends FlatArticle {
  children: TreeNode[];
}

export function buildTree(flat: FlatArticle[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const a of flat) map.set(a.id, { ...a, children: [] });

  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
