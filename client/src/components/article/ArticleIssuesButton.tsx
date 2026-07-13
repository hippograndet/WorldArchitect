import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.ts';

interface Props {
  wid: string;
  aid: string;
}

export default function ArticleIssuesButton({ wid, aid }: Props) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.issues.list(wid, aid),
      api.worldIssues.forArticle(wid, aid),
    ]).then(([issues, worldNotes]) => {
      if (cancelled) return;
      const openIssues = issues.filter((i) => i.status === 'open' || i.status === 'in_review').length;
      setCount(openIssues + worldNotes.length);
    }).catch(() => {
      if (!cancelled) setCount(0);
    });
    return () => { cancelled = true; };
  }, [wid, aid]);

  return (
    <button
      onClick={() => navigate(`/worlds/${wid}/inbox?article=${encodeURIComponent(aid)}`)}
      className={`px-3 py-1.5 text-xs border rounded-lg flex items-center gap-1 transition-colors ${
        count > 0
          ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
          : 'border-gray-300 text-gray-400 hover:bg-gray-50'
      }`}
    >
      <AlertTriangle size={14} /> Issues{count > 0 ? ` (${count})` : ''}
    </button>
  );
}
