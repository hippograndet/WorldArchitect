import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStore } from '../stores/index.ts';
import StatusBadge from '../components/shared/StatusBadge.tsx';

export default function TimelinePage() {
  const { wid } = useParams<{ wid: string }>();
  const { articles, loadArticles, addToast } = useStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wid) return;

    let cancelled = false;
    setLoading(true);

    loadArticles(wid)
      .catch((err) => {
        if (!cancelled) {
          addToast({ message: (err as Error).message, type: 'error' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [wid, loadArticles, addToast]);

  const dated = articles
    .filter((a) => a.temporalAnchorStart)
    .slice()
    .sort((a, b) => (a.temporalAnchorStart ?? '').localeCompare(b.temporalAnchorStart ?? ''));

  const undated = articles.filter((a) => !a.temporalAnchorStart);

  if (loading) {
    return (
      <div className="p-8 text-sm text-gray-400">Loading…</div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Timeline</h1>

      {articles.length === 0 && (
        <p className="text-sm text-gray-400 italic">
          No articles yet. Create articles first, then add date ranges to place them on the timeline.
        </p>
      )}

      {articles.length > 0 && dated.length === 0 && (
        <p className="text-sm text-gray-400 italic mb-8">
          No articles have a temporal anchor yet. Edit an article and set its date range to see it here.
        </p>
      )}

      {dated.length > 0 && (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[5.5rem] top-0 bottom-0 w-px bg-gray-200" />

          <div className="flex flex-col gap-6">
            {dated.map((a) => (
              <div key={a.id} className="flex gap-6 items-start">
                {/* Date label */}
                <div className="w-20 shrink-0 text-right pt-0.5">
                  <p className="text-xs font-mono text-gray-500 leading-snug">
                    {a.temporalAnchorStart}
                  </p>
                  {a.temporalAnchorEnd && (
                    <p className="text-xs font-mono text-gray-400">↓ {a.temporalAnchorEnd}</p>
                  )}
                </div>

                {/* Dot */}
                <div className="relative shrink-0 mt-1.5">
                  <div className={`w-3 h-3 rounded-full border-2 border-white ring-2 ${
                    a.isFixedPoint ? 'bg-amber-400 ring-amber-300' :
                    a.status === 'reviewed' ? 'bg-green-400 ring-green-200' :
                    a.status === 'draft'    ? 'bg-blue-400 ring-blue-200' :
                                             'bg-gray-300 ring-gray-200'
                  }`} />
                </div>

                {/* Content */}
                <div className="flex-1 pb-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Link
                      to={`/worlds/${wid}/articles/${a.id}`}
                      className="text-sm font-semibold text-gray-800 hover:text-blue-600"
                    >
                      {a.title}
                    </Link>
                    <StatusBadge status={a.status} />
                    {a.isFixedPoint && (
                      <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                        fixed point
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {undated.length > 0 && (
        <div className="mt-12">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Undated</h2>
          <div className="flex flex-col gap-2">
            {undated.map((a) => (
              <div key={a.id} className="flex items-center gap-3">
                <Link
                  to={`/worlds/${wid}/articles/${a.id}`}
                  className="text-sm text-gray-700 hover:text-blue-600"
                >
                  {a.title}
                </Link>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
