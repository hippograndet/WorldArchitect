export type WorldTone = 'narrative' | 'academic' | 'terse' | 'custom';

export interface WorldStyleInspiration {
  name: string;
  expandedDescription: string;
}

export type VisualTheme = 'default' | 'arcane_scroll' | 'data_link' | 'dossier' | 'obsidian_codex' | 'verdant_atlas';

export interface WorldStyleConfig {
  preset?: string;
  vibe: string;
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
