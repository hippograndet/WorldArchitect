export type WordCountPreset = 'short' | 'medium' | 'long' | 'custom';
export type DetailDepth = 'surface' | 'detailed' | 'exhaustive';
export type Breadth = 'focused' | 'connected';
export type ContextDepth = 'shallow' | 'mid' | 'deep';
export type HeraldMode = 'full' | 'improve';

export interface ExpansionParams {
  wordCountPreset: WordCountPreset;
  wordCountCustom?: number;
  detailDepth: DetailDepth;
  breadth: Breadth;
}

export interface ChildProposal {
  title: string;
  introduction: string;
  templateType: string;
  nodeKind: 'conceptual' | 'instance';
  nodeKindRationale: string;
}

export interface IdeaItem {
  id: string;
  theme: string;
  detail: string;
}

export interface EdgeProposal {
  sourceArticleId: string;
  sourceArticleTitle: string;
  targetArticleId: string;
  targetArticleTitle: string;
  linkType: 'references' | 'hierarchical';
  rationale: string;
}

export interface GlobalWarning {
  severity: 'warning' | 'conflict';
  type: 'coherence' | 'gap' | 'narrative' | 'thematic';
  description: string;
  involvedArticleIds: string[];
}

/** Stylizer rewrites content directly to match the world's style — not an advisory check. */
export interface StylizerResult {
  description: string;
  changesSummary?: string;
}

export interface TokenEstimate {
  estimatedTokens: number;
}
