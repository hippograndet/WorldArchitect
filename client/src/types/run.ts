export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'stopped' | 'failed';

export interface RunEvent {
  id: string;
  step: string;
  title: string;
  ok: boolean;
  message: string | null;
  createdAt: number;
}

export interface Run {
  id: string;
  worldId: string;
  ownerId: string;
  status: RunStatus;
  graphType: string;
  checkpointId: string;
  articleIds: string[];
  budgetUsed: number;
  budgetLimit: number;
  errorMessage: string | null;
  itemsCompleted: number;
  itemsTotal: number;
  createdAt: number;
  updatedAt: number;
}

export interface RunWithEvents extends Run {
  events: RunEvent[];
}
