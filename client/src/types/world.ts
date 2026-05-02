export type WorldTone = 'narrative' | 'academic' | 'terse' | 'custom';

export interface World {
  id: string;
  name: string;
  description: string;
  tags: string[];
  tone: WorldTone;
  originPoint: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorldInput {
  name: string;
  description: string;
  tags?: string[];
  tone?: WorldTone;
  originPoint?: string;
  generateStubs?: boolean;
}

export interface BibleMeta {
  tokenCount: number;
  threshold: number;
}
