export type WorldTone = 'narrative' | 'academic' | 'terse' | 'custom';

export interface WorldStyleInspiration {
  name: string;
}

export type NameEntityType = 'person' | 'place' | 'faction' | 'concept';
export type NameGender = 'male' | 'female' | 'neutral';
export type NameSocialClass = 'common' | 'noble';
export type NameComponent = 'full' | 'first' | 'family';

export interface NameEntry {
  id: string;
  worldId: string;
  name: string;
  profileId: string;
  entityType: NameEntityType;
  gender: NameGender;
  socialClass: NameSocialClass;
  nameComponent: NameComponent;
  tags: string[];
  source: 'generated' | 'user';
  createdAt: number;
}

export interface EntityMention {
  id: string;
  worldId: string;
  sourceArticleId: string;
  articleId: string | null;
  title: string;
  templateType: string;
  summary: string | null;
  status: 'pending' | 'created' | 'ignored';
  createdAt: number;
}

export interface ArticleIssue {
  id: string;
  worldId: string;
  articleId: string;
  source: 'rule' | 'linter' | 'publish_check' | 'warden';
  severity: 'blocking' | 'warning';
  code: string;
  excerpt: string | null;
  explanation: string;
  suggestion: string | null;
  status: 'open' | 'in_review' | 'dismissed' | 'fixed';
  createdAt: number;
}

export type WorldIssueType = 'coherence' | 'gap' | 'narrative' | 'thematic';
export type WorldIssueStatus = 'open' | 'in_review' | 'resolved' | 'dismissed';

export interface WorldIssue {
  id: string;
  worldId: string;
  severity: 'warning' | 'conflict';
  type: WorldIssueType;
  description: string;
  articleIds: string[];
  source: string;
  status: WorldIssueStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CulturalProfile {
  id: string;
  label: string;
  feel: string;
}

export type VisualTheme = 'default' | 'arcane_scroll' | 'data_link' | 'dossier' | 'obsidian_codex' | 'verdant_atlas';

export interface WorldStyleConfig {
  preset?: string;
  tonePreset?: string;
  tonePresetValue?: string;
  toneGuidance?: string;
  vibePreset?: string;
  vibePresetValue?: string;
  vibe: string;
  writingStylePreset?: string;
  writingStylePresetValue?: string;
  writingStyle: string;
  inspirations: WorldStyleInspiration[];
  constraints?: string;
  visualTheme?: VisualTheme;
}

export interface World {
  id: string;
  name: string;
  description: string;
  tags: string[];
  tone: WorldTone;
  originPoint: string | null;
  styleConfig?: WorldStyleConfig | null;
  createdAt: number;
  updatedAt: number;
}

export interface NameListResponse {
  names: NameEntry[];
  profiles: CulturalProfile[];
}

export interface CreateWorldInput {
  name: string;
  description: string;
  tags?: string[];
  tone?: WorldTone;
  originPoint?: string;
  styleConfig?: Partial<WorldStyleConfig>;
  generateStubs?: boolean;
}

export interface BibleMeta {
  tokenCount: number;
  threshold: number;
}
