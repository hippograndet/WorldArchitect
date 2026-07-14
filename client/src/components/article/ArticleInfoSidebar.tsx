import { Link, useParams } from 'react-router-dom';
import { useStore } from '../../stores/index.ts';
import type { TreeNode } from '../../lib/tree.ts';

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

export default function ArticleInfoSidebar() {
  const { wid, aid } = useParams<{ wid: string; aid: string }>();
  const { currentArticleDetail, treeNodes } = useStore();

  if (!currentArticleDetail) return null;

  const { links, version, article } = currentArticleDetail;

  const flat = flattenTree(treeNodes);
  const currentNode = flat.find((n) => n.id === aid);
  const parentNode = currentNode?.parentId ? flat.find((n) => n.id === currentNode.parentId) : null;

  const children   = links.filter((l) => l.linkType === 'hierarchical');
  const references = links.filter((l) => l.linkType === 'references');

  const wordCount = version?.wordCount ?? 0;
  const hasUnpublishedChanges = Boolean(article.publishedVersionId) && article.publishedVersionId !== article.currentVersionId;

  return (
    <aside className="w-60 shrink-0 sticky top-8 flex flex-col gap-4 text-xs">

      {/* Parent */}
      {parentNode && (
        <div>
          <p className="font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Parent</p>
          <Link
            to={`/worlds/${wid}/articles/${parentNode.id}`}
            className="flex items-center gap-1 text-blue-600 hover:underline"
          >
            <span className="text-gray-400">←</span>
            <span className="truncate">{parentNode.title}</span>
          </Link>
        </div>
      )}

      {/* Children */}
      {children.length > 0 && (
        <div>
          <p className="font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Children ({children.length})
          </p>
          <ul className="flex flex-col gap-1">
            {children.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/worlds/${wid}/articles/${c.id}`}
                  className="text-blue-600 hover:underline truncate block"
                >
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* References */}
      {references.length > 0 && (
        <div>
          <p className="font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            References ({references.length})
          </p>
          <ul className="flex flex-col gap-1">
            {references.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/worlds/${wid}/articles/${r.id}`}
                  className="text-blue-600 hover:underline truncate block"
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Document metadata — facts about the record itself, not the subject */}
      <div className="border-t border-gray-100 pt-3 flex flex-col gap-1 text-gray-500">
        <p className="font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Document</p>
        <div className="flex justify-between">
          <span className="text-gray-400">Status</span>
          <span className={`font-medium ${
            article.status === 'published' ? 'text-purple-600' :
            article.status === 'reviewed'  ? 'text-green-600' :
            article.status === 'draft'     ? 'text-blue-600' :
                                              'text-gray-500'
          }`}>{article.status}</span>
        </div>
        {hasUnpublishedChanges && (
          <div className="flex justify-between">
            <span className="text-gray-400">Since publish</span>
            <span className="font-medium text-amber-600">unpublished edits</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-400">Type</span>
          <span>{article.templateType}</span>
        </div>
        {wordCount > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-400">Words</span>
            <span>{wordCount.toLocaleString()}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
