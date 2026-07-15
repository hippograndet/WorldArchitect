import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import DiffField from './DiffField.tsx';

export default function PublishDiffPreview({
  wid,
  articleId,
  currentVersionId,
  publishedVersionId,
}: {
  wid: string;
  articleId: string;
  currentVersionId: string | null;
  publishedVersionId: string | null;
}) {
  const [content, setContent] = useState<{
    currentIntroduction: string;
    currentDescription: string;
    publishedIntroduction: string;
    publishedDescription: string;
  } | null>(null);

  useEffect(() => {
    setContent(null);
    if (!publishedVersionId || !currentVersionId) return;
    let cancelled = false;
    Promise.all([
      api.articles.versions.get(wid, articleId, currentVersionId),
      api.articles.versions.get(wid, articleId, publishedVersionId),
    ]).then(([current, published]) => {
      if (cancelled) return;
      setContent({
        currentIntroduction: current.introduction,
        currentDescription: current.description,
        publishedIntroduction: published.introduction,
        publishedDescription: published.description,
      });
    }).catch(() => {
      if (!cancelled) setContent(null);
    });
    return () => { cancelled = true; };
  }, [wid, articleId, currentVersionId, publishedVersionId]);

  if (!publishedVersionId) {
    return (
      <p className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Not published yet — this will be the first published version, so there's nothing to compare against.
      </p>
    );
  }

  if (!content) {
    return <p className="text-xs text-gray-400">Loading comparison against the published version…</p>;
  }

  return (
    <div className="space-y-3 rounded-md border border-gray-100 bg-gray-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Changes since published</p>
      <DiffField label="Introduction" before={content.publishedIntroduction} after={content.currentIntroduction} />
      <DiffField label="Description" before={content.publishedDescription} after={content.currentDescription} />
    </div>
  );
}
