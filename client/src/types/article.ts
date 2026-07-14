export type ArticleStatus = 'stub' | 'draft' | 'reviewed' | 'published';
export type TemplateType = 'general' | 'character' | 'location' | 'faction' | 'historical_event';

export interface Article {
  id: string;
  worldId: string;
  title: string;
  status: ArticleStatus;
  templateType: TemplateType;
  depth: number;
  isFixedPoint: boolean;
  currentVersionId: string | null;
  publishedVersionId: string | null;
  lockedByRunId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ArticleVersion {
  id: string;
  articleId: string;
  versionNumber: number;
  introduction: string;
  description: string;
  expansionParams: Record<string, unknown> | null;
  proposalUsed: Record<string, unknown> | null;
  wordCount: number;
  isRevert: boolean;
  revertedFromVersionId: string | null;
  createdAt: number;
}

export interface ArticleLink {
  id: string;
  title: string;
  introduction?: string;
  linkType: 'hierarchical' | 'references';
}

export interface ArticleGraphNode {
  id: string;
  title: string;
  status: ArticleStatus;
  templateType: TemplateType;
  depth: number;
  introduction: string;
}

export interface ArticleGraphEdge {
  source: string;
  target: string;
  linkType: 'hierarchical' | 'references';
}

export interface ArticleGraph {
  nodes: ArticleGraphNode[];
  edges: ArticleGraphEdge[];
}

export interface CoherenceWarning {
  id: string;
  articleId: string;
  sourceArticleId: string | null;
  severity: 'warning' | 'conflict';
  description: string;
  status: 'open' | 'accepted' | 'resolved';
  createdAt: number;
}

export interface ArticleDetail {
  article: Article;
  version: ArticleVersion | null;
  introduction: string;
  links: ArticleLink[];
  openWarnings: CoherenceWarning[];
}

/** Conceptual (infobox) fact — distinct from document metadata like status/word count. */
export interface ArticleMetadataFact {
  id: string;
  articleId: string;
  subjectType: string | null;
  key: string;
  value: unknown;
  authority: string;
  createdAt: number;
  updatedAt: number;
}

export interface PendingDraft {
  id: string;
  articleId: string;
  worldId: string | null;
  status: 'pending' | 'accepted' | 'discarded';
  sourceRunId: string | null;
  runType: string;
  contextBasis: 'current' | 'latest_draft' | 'published';
  contextDraftIds: string[];
  displayTitle: string | null;
  selectedProposal: Record<string, unknown> | null;
  pipelineType: string;
  autoSelect: boolean;
  expansionParams: Record<string, unknown>;
  phase: string;
  contextPackage: Record<string, unknown> | null;
  concepts: unknown[] | null;
  parentUpdate: { articleId: string; appendText: string } | null;
  draftContent: DraftContent | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export type AcceptDraftResult =
  | { article: Article; version: ArticleVersion }
  | { article: Article; childArticle: Article; childVersion: ArticleVersion };

export interface DraftContent {
  description?: string;
  introduction?: string;
  childDescription?: string;
  parentAppend?: string;
  coherenceWarnings?: CoherenceWarning[];
  suggestedLinks?: { targetArticleTitle: string; targetArticleId: string | null }[];
  retentionIssues?: { description: string; severity: 'warning' | 'critical' }[];
}
