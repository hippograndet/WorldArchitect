import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the api module before any store imports resolve it
// ---------------------------------------------------------------------------

const mockApi = vi.hoisted(() => ({
  agents: {
    audit: vi.fn(),
    propose: vi.fn(),
    proposeChildren: vi.fn(),
    summarize: vi.fn(),
    cohere: vi.fn(),
    expand: vi.fn(),
    estimate: vi.fn(),
  },
  articles: {
    batch: vi.fn(),
    update: vi.fn(),
    draft: { accept: vi.fn(), discard: vi.fn(), acceptById: vi.fn(), discardById: vi.fn() },
  },
  bible: {
    getMeta: vi.fn(),
  },
  runs: {
    create: vi.fn(),
    get: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
  },
  worlds: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
}));

vi.mock('../lib/api.ts', () => ({ api: mockApi }));

// ---------------------------------------------------------------------------
// Store factory (fresh instance per test to avoid state leakage)
// ---------------------------------------------------------------------------

import { createStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { worldSlice } from './worldSlice.ts';
import { articleSlice } from './articleSlice.ts';
import { uiSlice } from './uiSlice.ts';
import { agentSlice, defaultAgentRuntime } from './agentSlice.ts';
import { forgeSlice, defaultForgeRuntime } from './forgeSlice.ts';

function makeStore() {
  return createStore(
    immer((...a: Parameters<typeof worldSlice>) => ({
      ...worldSlice(...a),
      ...articleSlice(...a),
      ...uiSlice(...a),
      ...agentSlice(...a),
      ...forgeSlice(...a),
    })),
  );
}

type Store = ReturnType<typeof makeStore>;

let store: Store;
beforeEach(() => {
  vi.clearAllMocks();
  store = makeStore();
});

const S = () => store.getState();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const staleWarning = {
  severity: 'warning' as const,
  type: 'gap' as const,
  description: 'stale warning',
  involvedArticleIds: ['art1'],
};

const staleIdea = { id: 'idea1', theme: 'stale idea', detail: 'stale detail' };

// ---------------------------------------------------------------------------
// openAgentPanel / closeAgentPanel
// ---------------------------------------------------------------------------

describe('openAgentPanel / closeAgentPanel', () => {
  it('closeAgentPanel restores the agent and forge runtime fields to their defaults', () => {
    S().openAgentPanel('art1', 'Some Article', 'spark');

    // Simulate leftover state from a prior run that a plain re-open/close should wipe.
    store.setState((s) => {
      s.agentAuditGlobalWarnings = [staleWarning];
      s.agentSelectedIdeas = [staleIdea];
      s.forgeRunning = true;
      s.forgeRunId = 'run1';
    });

    S().closeAgentPanel();

    expect(S().agentAuditGlobalWarnings).toEqual(defaultAgentRuntime.agentAuditGlobalWarnings);
    expect(S().agentSelectedIdeas).toEqual(defaultAgentRuntime.agentSelectedIdeas);
    expect(S().forgeRunning).toBe(defaultForgeRuntime.forgeRunning);
    expect(S().forgeRunId).toBe(defaultForgeRuntime.forgeRunId);
    expect(S().agentPhase).toBe('idle');
    expect(S().agentPanelOpen).toBe(false);
  });

  it('openAgentPanel wipes runtime state left over from a previous panel session', () => {
    store.setState((s) => {
      s.agentDraftResult = { introduction: 'stale draft' };
      s.agentError = 'stale error';
    });

    S().openAgentPanel('art2', 'Another Article', 'spark');

    expect(S().agentDraftResult).toEqual(defaultAgentRuntime.agentDraftResult);
    expect(S().agentError).toEqual(defaultAgentRuntime.agentError);
    expect(S().agentPhase).toBe('configuring');
    expect(S().agentTargetArticleId).toBe('art2');
  });
});

// ---------------------------------------------------------------------------
// agentRetry — regression test: this used to leave audit/idea state stale
// ---------------------------------------------------------------------------

describe('agentRetry', () => {
  it('clears agentAuditGlobalWarnings left over from a prior audit run', () => {
    store.setState((s) => {
      s.agentAuditGlobalWarnings = [staleWarning];
      s.agentSelectedIdeas = [staleIdea];
    });

    S().agentRetry();

    expect(S().agentAuditGlobalWarnings).toEqual([]);
    expect(S().agentSelectedIdeas).toEqual([]);
    expect(S().agentPhase).toBe('configuring');
  });
});

// ---------------------------------------------------------------------------
// agentDiscard — regression test: this used to leave idea/style-check state stale
// ---------------------------------------------------------------------------

describe('agentDiscard', () => {
  it('clears agentSelectedIdeas without touching the server for a non-draft pipeline', async () => {
    S().openAgentPanel('art1', 'Some Article', 'spark', 'cohere');
    store.setState((s) => {
      s.agentSelectedIdeas = [staleIdea];
      s.agentStyleCheck = { issues: [], overallToneMatch: 'good', summary: 'stale summary' };
    });

    await S().agentDiscard('w1');

    expect(S().agentSelectedIdeas).toEqual([]);
    expect(S().agentStyleCheck).toBeNull();
    expect(S().agentPhase).toBe('idle');
    expect(S().agentPanelOpen).toBe(false);
    expect(mockApi.articles.draft.discard).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// agentCommit — expand_description/forge_expand write directly, no draft
// ---------------------------------------------------------------------------

describe('agentCommit', () => {
  it('commits expand_description via articles.update directly, not the draft accept flow', async () => {
    S().openAgentPanel('art1', 'Some Article', 'spark', 'expand_description');
    store.setState((s) => {
      s.agentDraftResult = { description: 'New description text.' };
    });
    mockApi.articles.update.mockResolvedValue({
      article: { id: 'art1' },
      version: { id: 'v2', introduction: '' },
    });

    await S().agentCommit('w1');

    expect(mockApi.articles.update).toHaveBeenCalledWith('w1', 'art1', { description: 'New description text.' });
    expect(mockApi.articles.draft.accept).not.toHaveBeenCalled();
    expect(mockApi.articles.draft.acceptById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lingering draft cleanup — a create_child/reorganize draft must never
// outlive the panel session (no separate Inbox-based accept later)
// ---------------------------------------------------------------------------

describe('lingering draft cleanup on panel reset', () => {
  it('discards an undecided create_child draft when the panel is closed', () => {
    S().openAgentPanel('art1', 'Some Article', 'spark', 'create_child');
    store.setState((s) => {
      s.currentWorldId = 'w1';
      s.agentLoadedDraftId = 'draft1';
    });

    S().closeAgentPanel();

    expect(mockApi.articles.draft.discardById).toHaveBeenCalledWith('w1', 'art1', 'draft1');
  });

  it('does not attempt to discard for expand_description, which never persists a draft', () => {
    S().openAgentPanel('art1', 'Some Article', 'spark', 'expand_description');
    store.setState((s) => {
      s.currentWorldId = 'w1';
      s.agentLoadedDraftId = 'draft1'; // should be impossible in practice, but guard against it anyway
    });

    S().closeAgentPanel();

    expect(mockApi.articles.draft.discardById).not.toHaveBeenCalled();
  });
});

describe('startForge', () => {
  it('forwards the configured run validation level to the runs API', async () => {
    vi.useFakeTimers();
    mockApi.runs.create.mockResolvedValue({ id: 'run1' });

    try {
      S().openAgentPanel('art1', 'Some Article', 'spark', 'forge_expand');
      S().setAgentParams({
        runValidationLevel: 'assisted',
        forgeContinuationMode: 'finish_document',
      });

      await S().startForge('w1');

      expect(mockApi.runs.create).toHaveBeenCalledWith('w1', expect.objectContaining({
        articleIds: ['art1'],
        pipelineType: 'forge_expand',
        validationLevel: 'assisted',
        forgeContinuationMode: 'finish_document',
      }));
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
