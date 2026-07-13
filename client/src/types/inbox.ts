export type InboxLane = 'drafts' | 'publish' | 'flags' | 'suggestions' | 'concepts' | 'run_checkpoints' | 'history';

export interface InboxItem {
  id: string;
  lane: InboxLane;
  kind: string;
  title: string;
  status: string;
  severity: string | null;
  articleIds: string[];
  createdAt: number;
  source: string;
  payload: Record<string, unknown>;
}

export interface InboxResponse {
  items: InboxItem[];
}

export interface InboxCountResponse {
  open: number;
  byLane: Partial<Record<InboxLane, number>>;
}
