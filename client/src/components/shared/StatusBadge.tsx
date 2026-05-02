import type { ArticleStatus } from '../../types/article.ts';

const styles: Record<ArticleStatus, string> = {
  stub:     'bg-gray-100 text-gray-600',
  draft:    'bg-blue-100 text-blue-700',
  reviewed: 'bg-green-100 text-green-700',
};

interface Props {
  status: ArticleStatus;
}

export default function StatusBadge({ status }: Props) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
