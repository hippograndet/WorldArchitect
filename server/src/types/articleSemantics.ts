export type ArticleSubjectType =
  | 'general'
  | 'character'
  | 'location'
  | 'faction'
  | 'event'
  | 'concept'
  | 'object'
  | 'organization';

export type ArticleContextMode =
  | 'working_current'
  | 'reviewed'
  | 'published'
  | 'snapshot';

export type ArticleFactAuthority =
  | 'published'
  | 'reviewed'
  | 'user_confirmed'
  | 'draft'
  | 'agent_suggested'
  | 'inferred';

export type ArticleDependencyType =
  | 'reference'
  | 'hierarchy'
  | 'factual'
  | 'temporal'
  | 'metadata';

export interface ArticleContextSource {
  articleId: string;
  versionId?: string | null;
  contextMode?: ArticleContextMode;
  authority?: ArticleFactAuthority;
}

export interface ArticleDependencyReference {
  sourceArticleId: string;
  sourceVersionId?: string | null;
  targetArticleId: string;
  targetVersionId?: string | null;
  dependencyType: ArticleDependencyType;
  reason?: string;
}

export interface ArticleMetadataFact {
  articleId: string;
  subjectType?: ArticleSubjectType;
  key: string;
  value: unknown;
  authority: ArticleFactAuthority;
  sourceVersionId?: string | null;
}

export interface ProposedArticleMetadataChange {
  articleId: string;
  subjectType?: ArticleSubjectType;
  key: string;
  value: unknown;
  reason?: string;
}
