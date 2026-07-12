import { requiresUserReview } from './helpers.js';
import type { ForgeState } from '../forgeState.js';

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export const END_KEY = '__end__';

export function routeAfterDequeue(state: ForgeState): 'research' | typeof END_KEY {
  return state.signal === 'continue' ? 'research' : END_KEY;
}

export function routeAfterResearch(state: ForgeState): 'inception' | typeof END_KEY {
  return state.lastStepError?.fatal ? END_KEY : 'inception';
}

export function routeAfterInception(state: ForgeState): 'expansion' | 'finishItem' | typeof END_KEY {
  if (state.signal === 'needs_input') return END_KEY;
  if (state.lastStepError?.fatal) return END_KEY;
  if (state.lastStepError) return 'finishItem';
  if (state.forgeContinuationMode === 'one_step') return 'finishItem';
  return 'expansion';
}

export function routeAfterExpansion(state: ForgeState): 'branching' | 'finishItem' | typeof END_KEY {
  if (state.signal === 'needs_input') return END_KEY;
  if (state.lastStepError?.fatal) return END_KEY;
  if (state.lastStepError) return 'finishItem';
  if (state.forgeContinuationMode === 'one_step') return 'finishItem';
  if (state.commitPolicy !== 'auto_commit' && !requiresUserReview(state)) return 'finishItem';
  return 'branching';
}

export function routeAfterBranching(state: ForgeState): 'finishItem' | typeof END_KEY {
  if (state.signal === 'needs_input') return END_KEY;
  return state.lastStepError?.fatal ? END_KEY : 'finishItem';
}
