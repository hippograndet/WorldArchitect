import type { StateCreator } from 'zustand';
import type { StoreState } from './index.ts';
import { api } from '../lib/api.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForgeItem {
  articleId: string;
  title: string;
  depth: number;
}

export interface ForgeLogEntry {
  step: string;
  title: string;
  ok: boolean;
  ts: number;
}

export interface ForgeSlice {
  forgeRunning: boolean;
  forgePaused: boolean;
  forgeQueue: ForgeItem[];
  forgeLog: ForgeLogEntry[];
  forgeCurrentTitle: string | null;
  forgeCurrentStep: string | null;
  forgeCompleted: number;
  forgeTotal: number;

  startForge: (worldId: string) => Promise<void>;
  pauseForge: () => void;
  resumeForge: (worldId: string) => Promise<void>;
  stopForge: () => void;
}

// ---------------------------------------------------------------------------
// Slice implementation
// ---------------------------------------------------------------------------

export const forgeSlice: StateCreator<StoreState, [['zustand/immer', never]], [], ForgeSlice> = (set, get) => {

  // Runs as long as the queue is non-empty and forge is not paused/stopped.
  // Reads agentParams from agentSlice via get() — both live in the same store.
  const runForgeLoop = async (worldId: string) => {
    while (true) {
      const state = get();
      if (!state.forgeRunning || state.forgePaused) break;

      const queue = state.forgeQueue;
      if (queue.length === 0) break;

      const item = { ...queue[0] };
      const { contextDepth, branchingMode, forgeMode, forgeMaxDepth, forgeMaxChildren } = state.agentParams;

      set((s) => {
        s.forgeQueue.shift();
        s.forgeCurrentTitle = item.title;
        s.forgeCurrentStep  = 'Inception';
      });

      try {
        // ── Step 1: Inception ──────────────────────────────────────────────
        const introResult = await api.agents.summarize(worldId, {
          articleId: item.articleId,
          mode:      'improve',
        });
        await api.bible.updateEntry(worldId, item.articleId, introResult.introduction);
        set((s) => { s.forgeLog.unshift({ step: 'Inception', title: item.title, ok: true, ts: Date.now() }); });

        if (!get().forgeRunning || get().forgePaused) break;

        // ── Step 2: Expansion (auto-select proposal, no Oracle) ────────────
        set((s) => { s.forgeCurrentStep = 'Expansion'; });
        const proposalResult = await api.agents.propose(worldId, {
          articleId:    item.articleId,
          pipelineType: 'expand_description',
          autoSelect:   true,
          contextDepth,
        });
        const selectedIndex = proposalResult.autoSelectedIndex ?? 0;
        await api.agents.expand(worldId, {
          articleId:             item.articleId,
          pipelineType:          'expand_description',
          selectedProposalIndex: selectedIndex,
          proposals:             proposalResult.proposals,
          contextDepth,
        });
        await api.articles.draft.accept(worldId, item.articleId);
        set((s) => { s.forgeLog.unshift({ step: 'Expansion', title: item.title, ok: true, ts: Date.now() }); });

        if (!get().forgeRunning || get().forgePaused) break;

        // ── Step 3: Branching (if within depth limit) ──────────────────────
        if (item.depth < forgeMaxDepth) {
          set((s) => { s.forgeCurrentStep = 'Branching'; });
          const branchHint = branchingMode === 'specific'
            ? 'Prefer specific named instances (individual entities, real examples). '
            : 'Prefer conceptual categories and systems. ';

          const childResult = await api.agents.proposeChildren(worldId, {
            articleId:    item.articleId,
            contextDepth,
            userSpec:     branchHint,
          });

          const take = forgeMaxChildren > 0
            ? childResult.proposals.slice(0, forgeMaxChildren)
            : childResult.proposals;

          const batchResult = await api.articles.batch(worldId, {
            parentArticleId: item.articleId,
            children: take.map((p) => ({
              title:        p.title,
              introduction: p.introduction,
              templateType: p.templateType as 'general' | 'character' | 'location' | 'faction' | 'historical_event',
            })),
          });

          const newItems: ForgeItem[] = batchResult.created.map((c) => ({
            articleId: c.id,
            title:     c.title,
            depth:     item.depth + 1,
          }));

          set((s) => {
            if (forgeMode === 'breadth') {
              s.forgeQueue.push(...newItems);
            } else {
              s.forgeQueue.unshift(...newItems);
            }
            s.forgeTotal += newItems.length;
            s.forgeLog.unshift({ step: 'Branching', title: item.title, ok: true, ts: Date.now() });
          });
        }
      } catch (err) {
        const stepName = get().forgeCurrentStep ?? '?';
        set((s) => {
          s.forgeLog.unshift({ step: stepName, title: item.title, ok: false, ts: Date.now() });
        });
        console.error(`Forge error on "${item.title}" (${stepName}):`, err);
      }

      set((s) => { s.forgeCompleted++; });
    }

    // ── Loop ended ────────────────────────────────────────────────────────
    const finalState = get();
    if (finalState.forgeRunning && !finalState.forgePaused) {
      await get().loadTree(worldId).catch(console.error);
      set((s) => {
        s.forgeRunning       = false;
        s.forgeCurrentTitle  = null;
        s.forgeCurrentStep   = null;
        s.agentPhase         = 'forge_done';
      });
    }
  };

  return {
    forgeRunning: false,
    forgePaused: false,
    forgeQueue: [],
    forgeLog: [],
    forgeCurrentTitle: null,
    forgeCurrentStep: null,
    forgeCompleted: 0,
    forgeTotal: 0,

    startForge: async (worldId) => {
      const { agentTargetArticleId, agentTargetArticleTitle } = get();
      if (!agentTargetArticleId) return;

      set((s) => {
        s.agentPhase        = 'forging';
        s.forgeRunning      = true;
        s.forgePaused       = false;
        s.forgeQueue        = [{ articleId: agentTargetArticleId, title: agentTargetArticleTitle ?? 'Article', depth: 0 }];
        s.forgeLog          = [];
        s.forgeCurrentTitle = null;
        s.forgeCurrentStep  = null;
        s.forgeCompleted    = 0;
        s.forgeTotal        = 1;
        s.agentError        = null;
      });

      await runForgeLoop(worldId);
    },

    pauseForge: () => {
      set((s) => { s.forgePaused = true; });
    },

    resumeForge: async (worldId) => {
      set((s) => { s.forgePaused = false; });
      await runForgeLoop(worldId);
    },

    stopForge: () => {
      set((s) => {
        s.forgeRunning      = false;
        s.forgePaused       = false;
        s.forgeQueue        = [];
        s.forgeCurrentTitle = null;
        s.forgeCurrentStep  = null;
        s.agentPhase        = 'forge_done';
      });
    },
  };
};
