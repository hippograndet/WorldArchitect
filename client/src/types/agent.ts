export type WordCountPreset = 'short' | 'medium' | 'long' | 'custom';
export type DetailDepth = 'surface' | 'detailed' | 'exhaustive';
export type ChronologicalDepth = 'none' | 'shallow' | 'deep';
export type Breadth = 'focused' | 'connected';

export interface ExpansionParams {
  wordCountPreset: WordCountPreset;
  wordCountCustom?: number;
  detailDepth: DetailDepth;
  chronologicalDepth: ChronologicalDepth;
  breadth: Breadth;
}

export interface Proposal {
  title: string;
  direction: string;
}

export interface ChildProposal {
  title: string;
  introduction: string;
  templateType: string;
}

export interface TokenEstimate {
  estimatedTokens: number;
}
