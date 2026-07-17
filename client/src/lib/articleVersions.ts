import type { ArticleVersion } from '../types/article.ts';

export function draftPhase(v: Pick<ArticleVersion, 'id' | 'introduction' | 'description'>, publishedVersionId: string | null): string {
  if (!v.introduction && !v.description) return 'stub';
  return v.id === publishedVersionId ? 'published' : 'draft';
}
