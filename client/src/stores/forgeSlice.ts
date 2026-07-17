import type { StateCreator } from 'zustand';
import type { StoreState } from './index.ts';
import { api } from '../lib/api.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForgeLogEntry {
  step: string;
  title: string;
  ok: boolean;
  message: string | null;
  ts: number;
}

export interface ForgeSlice {
  forgeRunning: boolean;
  forgePaused: boolean;
  forgeRunId: string | null;
  forgeLog: ForgeLogEntry[];
  forgeCurrentTitle: string | null;
  forgeCurrentStep: string | null;
  forgeCompleted: number;
  forgeTotal: number;

  startForge: (worldId: string) => Promise<void>;
  pauseForge: (worldId: string) => Promise<void>;
  resumeForge: (worldId: string) => Promise<void>;
  stopForge: (worldId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Slice implementation
//
// Forge itself (Inception -> Expansion -> Branching, recursive) now runs
// entirely server-side as a LangGraph graph (server/src/agents/graphs/
// forgeGraph.ts) — this slice's job shrank from running the loop to
// creating the run and polling its status, the same "no streaming, poll
// instead" pattern already used elsewhere in this codebase. Same fields,
// same ForgeConfigView/ForgeProgressView contract; only the internals
// changed from a client-side while(true) loop to create+poll.
// ---------------------------------------------------------------------------

export const defaultForgeRuntime: Pick<
  ForgeSlice,
  'forgeRunning' | 'forgePaused' | 'forgeRunId' | 'forgeLog' | 'forgeCurrentTitle' | 'forgeCurrentStep' | 'forgeCompleted' | 'forgeTotal'
> = {
  forgeRunning: false,
  forgePaused: false,
  forgeRunId: null,
  forgeLog: [],
  forgeCurrentTitle: null,
  forgeCurrentStep: null,
  forgeCompleted: 0,
  forgeTotal: 0,
};

const POLL_INTERVAL_MS = 1500;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

function stopPolling(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

export const forgeSlice: StateCreator<StoreState, [['zustand/immer', never]], [], ForgeSlice> = (set, get) => {

  const poll = (worldId: string, runId: string) => {
    stopPolling();
    pollTimer = setTimeout(async () => {
      // A newer run started (or the panel was closed/reset) while this tick was
      // scheduled — stop silently instead of clobbering the current state.
      if (get().forgeRunId !== runId) return;

      try {
        const run = await api.runs.get(worldId, runId);
        if (get().forgeRunId !== runId) return;

        const treeNeedsRefresh = run.itemsTotal > get().forgeTotal;

        set((s) => {
          s.forgeCompleted = run.itemsCompleted;
          s.forgeTotal = run.itemsTotal;
          s.forgeLog = run.events.map((e) => ({
            step: e.step,
            title: e.title,
            ok: e.ok,
            message: e.message,
            ts: e.createdAt,
          }));
          const latest = run.events[0];
          if (latest) {
            s.forgeCurrentTitle = latest.title;
            s.forgeCurrentStep = latest.step;
          }
        });

        if (treeNeedsRefresh) {
          await get().loadTree(worldId).catch(console.error);
        }

        if (run.status === 'paused' || run.status === 'needs_input') {
          set((s) => {
            s.forgePaused = true;
            if (run.status === 'needs_input') s.agentPhase = 'reviewing';
          });
          return; // resumeForge restarts polling
        }

        if (run.status === 'completed' || run.status === 'stopped' || run.status === 'failed') {
          if (run.status === 'failed' && run.errorMessage) {
            set((s) => { s.agentError = run.errorMessage; });
          }
          await get().loadTree(worldId).catch(console.error);
          set((s) => {
            s.forgeRunning       = false;
            s.forgePaused        = false;
            s.forgeRunId         = null;
            s.forgeCurrentTitle  = null;
            s.forgeCurrentStep   = null;
            s.agentPhase         = 'forge_done';
          });
          return;
        }

        poll(worldId, runId);
      } catch (err) {
        console.error('Forge status poll failed:', err);
        poll(worldId, runId);
      }
    }, POLL_INTERVAL_MS);
  };

  return {
    ...defaultForgeRuntime,

    startForge: async (worldId) => {
      const { agentTargetArticleId, agentPipelineType, agentParams } = get();
      if (!agentTargetArticleId) return;
      const {
        contextDepth, contextBasis, branchingMode, forgeMode, forgeMaxDepth, forgeMaxChildren,
        coherenceCheckLevel, safetyNet, runStylizer, userSpec,
        forgeContinuationMode, runValidationLevel,
        forgeInceptionExistingMode, forgeExpansionExistingMode, forgeBranchingExistingMode,
      } = agentParams;

      set((s) => {
        s.agentPhase        = 'forging';
        s.forgeRunning      = true;
        s.forgePaused       = false;
        s.forgeLog          = [];
        s.forgeCurrentTitle = null;
        s.forgeCurrentStep  = null;
        s.forgeCompleted    = 0;
        s.forgeTotal        = 1;
        s.agentError        = null;
      });

      try {
        const run = await api.runs.create(worldId, {
          articleIds: [agentTargetArticleId],
          pipelineType: agentPipelineType,
          contextDepth,
          contextBasis,
          branchingMode,
          forgeMode,
          forgeMaxDepth,
          forgeMaxChildren,
          coherenceCheckLevel,
          safetyNet,
          runStylizer,
          userSpec: userSpec || undefined,
          forgeContinuationMode,
          validationLevel: runValidationLevel,
          forgeInceptionExistingMode,
          forgeExpansionExistingMode,
          forgeBranchingExistingMode,
        });
        set((s) => { s.forgeRunId = run.id; });
        poll(worldId, run.id);
      } catch (err) {
        set((s) => {
          s.forgeRunning = false;
          s.agentPhase = 'forge_done';
          s.agentError = err instanceof Error ? err.message : 'Failed to start Forge run.';
        });
      }
    },

    pauseForge: async (worldId) => {
      const { forgeRunId } = get();
      if (!forgeRunId) return;
      stopPolling();
      set((s) => { s.forgePaused = true; });
      await api.runs.pause(worldId, forgeRunId).catch(console.error);
    },

    resumeForge: async (worldId) => {
      const { forgeRunId } = get();
      if (!forgeRunId) return;
      set((s) => { s.forgePaused = false; });
      await api.runs.resume(worldId, forgeRunId);
      poll(worldId, forgeRunId);
    },

    stopForge: async (worldId) => {
      const { forgeRunId } = get();
      stopPolling();
      if (forgeRunId) await api.runs.cancel(worldId, forgeRunId).catch(console.error);
      set((s) => {
        s.forgeRunning      = false;
        s.forgePaused       = false;
        s.forgeRunId        = null;
        s.forgeCurrentTitle = null;
        s.forgeCurrentStep  = null;
        s.agentPhase        = 'forge_done';
      });
    },
  };
};
