import type { ArticleIssue, WorldIssue } from '../types/world.ts';

export type ConsolidationScope = 'world' | 'article';
export type ConsolidationSeverity = 'warning' | 'conflict' | 'blocking';
export type ConsolidationBucket = 'active' | 'closed' | 'dismissed';

export interface ConsolidationIssue {
  id: string;
  scope: ConsolidationScope;
  severity: ConsolidationSeverity;
  source: string;
  description: string;
  articleIds: string[];
  articleTitles: string[];
  status: string;
  createdAt: number;
  raw: WorldIssue | ArticleIssue;
}

export function bucketForStatus(status: string): ConsolidationBucket {
  if (status === 'dismissed') return 'dismissed';
  if (status === 'resolved' || status === 'fixed') return 'closed';
  return 'active';
}

export interface DocumentGroup {
  articleId: string | null;
  title: string;
  issues: ConsolidationIssue[];
  counts: { warning: number; conflict: number; blocking: number };
}

const WORST_FIRST: ConsolidationSeverity[] = ['blocking', 'conflict', 'warning'];

export function worstSeverity(counts: DocumentGroup['counts']): ConsolidationSeverity | null {
  for (const sev of WORST_FIRST) {
    if (counts[sev] > 0) return sev;
  }
  return null;
}

export function groupByDocument(issues: ConsolidationIssue[]): DocumentGroup[] {
  const worldGroup: DocumentGroup = {
    articleId: null,
    title: 'World-wide',
    issues: [],
    counts: { warning: 0, conflict: 0, blocking: 0 },
  };
  const byArticle = new Map<string, DocumentGroup>();

  for (const issue of issues) {
    const isSingleArticle = issue.articleIds.length === 1;
    const target = isSingleArticle
      ? byArticle.get(issue.articleIds[0]) ?? (() => {
          const g: DocumentGroup = {
            articleId: issue.articleIds[0],
            title: issue.articleTitles[0] ?? issue.articleIds[0],
            issues: [],
            counts: { warning: 0, conflict: 0, blocking: 0 },
          };
          byArticle.set(issue.articleIds[0], g);
          return g;
        })()
      : worldGroup;

    target.issues.push(issue);
    target.counts[issue.severity] += 1;
  }

  const documentGroups = [...byArticle.values()].sort((a, b) => b.issues.length - a.issues.length);
  const groups = worldGroup.issues.length > 0 ? [worldGroup, ...documentGroups] : documentGroups;
  return groups;
}

export interface IssueFilters {
  bucket?: ConsolidationBucket;
  severity?: ConsolidationSeverity;
  source?: string;
  query?: string;
}

export function filterIssues(issues: ConsolidationIssue[], filters: IssueFilters): ConsolidationIssue[] {
  const q = filters.query?.trim().toLowerCase();
  return issues.filter((issue) => {
    if (filters.bucket && bucketForStatus(issue.status) !== filters.bucket) return false;
    if (filters.severity && issue.severity !== filters.severity) return false;
    if (filters.source && issue.source !== filters.source) return false;
    if (q && !issue.description.toLowerCase().includes(q)) return false;
    return true;
  });
}
