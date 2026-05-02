import type { StateCreator } from 'zustand';
import type { StoreState } from './index.ts';
import { api } from '../lib/api.ts';
import type { Proposal, ChildProposal } from '../types/agent.ts';
import type { DraftContent, PendingDraft } from '../types/article.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentPhase =
  | 'idle'
  | 'configuring'
  | 'estimating'
  | 'generating'
  | 'proposals_ready'
  | 'expanding'
  | 'reviewing'
  | 'done'
  | 'error';

export type PipelineType =
  | 'expand_description'
  | 'create_child'
  | 'propose_children'
  | 'expand_chronology'
  | 'reorganize'
  | 'summarize'
  | 'cohere';

export interface AgentParams {
  wordCountPreset: 'short' | 'medium' | 'long';
  detailDepth: 'surface' | 'detailed' | 'exhaustive';
  breadth: 'focused' | 'connected';
  userSpec: string;
}

const defaultParams: AgentParams = {
  wordCountPreset: 'medium',
  detailDepth: 'detailed',
  breadth: 'focused',
  userSpec: '',
};

// Pipelines that save a pending_draft on the server and commit via POST /accept
const DRAFT_PIPELINES: PipelineType[] = [
  'expand_description',
  'create_child',
  'expand_chronology',
  'reorganize',
];

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface AgentSlice {
  agentPhase: AgentPhase;
  agentPanelOpen: boolean;
  agentTargetArticleId: string | null;
  agentTargetArticleTitle: string | null;
  agentPipelineType: PipelineType;
  agentParams: AgentParams;
  agentProposals: Proposal[];
  agentChildProposals: ChildProposal[];
  agentSelectedProposalIndex: number | null;
  agentDraftResult: DraftContent | null;
  agentEstimatedTokens: number | null;
  agentError: string | null;

  openAgentPanel: (articleId: string, articleTitle: string, pipeline?: PipelineType) => void;
  closeAgentPanel: () => void;
  setAgentPipelineType: (type: PipelineType) => void;
  setAgentParams: (params: Partial<AgentParams>) => void;
  selectAgentProposal: (index: number) => void;
  agentRetry: () => void;
  loadDraftIntoPanel: (draft: PendingDraft) => void;

  runAgentEstimate: (worldId: string) => Promise<void>;
  runAgentGenerate: (worldId: string) => Promise<void>;
  runAgentExpand: (worldId: string) => Promise<void>;
  agentCommit: (worldId: string) => Promise<void>;
  agentDiscard: (worldId: string) => Promise<void>;
  agentBatchCreate: (worldId: string, selectedIndices: number[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Slice implementation
// ---------------------------------------------------------------------------

export const agentSlice: StateCreator<StoreState, [['zustand/immer', never]], [], AgentSlice> = (set, get) => ({
  agentPhase: 'idle',
  agentPanelOpen: false,
  agentTargetArticleId: null,
  agentTargetArticleTitle: null,
  agentPipelineType: 'expand_description',
  agentParams: { ...defaultParams },
  agentProposals: [],
  agentChildProposals: [],
  agentSelectedProposalIndex: null,
  agentDraftResult: null,
  agentEstimatedTokens: null,
  agentError: null,

  openAgentPanel: (articleId, articleTitle, pipeline = 'expand_description') => {
    set((s) => {
      s.agentPhase = 'configuring';
      s.agentPanelOpen = true;
      s.agentTargetArticleId = articleId;
      s.agentTargetArticleTitle = articleTitle;
      s.agentPipelineType = pipeline;
      s.agentProposals = [];
      s.agentChildProposals = [];
      s.agentSelectedProposalIndex = null;
      s.agentDraftResult = null;
      s.agentEstimatedTokens = null;
      s.agentError = null;
      s.agentParams = { ...defaultParams };
    });
  },

  closeAgentPanel: () => {
    set((s) => {
      s.agentPhase = 'idle';
      s.agentPanelOpen = false;
      s.agentProposals = [];
      s.agentChildProposals = [];
      s.agentSelectedProposalIndex = null;
      s.agentDraftResult = null;
      s.agentError = null;
    });
  },

  setAgentPipelineType: (type) => {
    set((s) => {
      s.agentPipelineType = type;
      s.agentProposals = [];
      s.agentChildProposals = [];
      s.agentSelectedProposalIndex = null;
      s.agentDraftResult = null;
    });
  },

  setAgentParams: (params) => {
    set((s) => { Object.assign(s.agentParams, params); });
  },

  selectAgentProposal: (index) => {
    set((s) => { s.agentSelectedProposalIndex = index; });
  },

  agentRetry: () => {
    set((s) => {
      s.agentPhase = 'configuring';
      s.agentError = null;
      s.agentProposals = [];
      s.agentChildProposals = [];
      s.agentSelectedProposalIndex = null;
      s.agentDraftResult = null;
    });
  },

  loadDraftIntoPanel: (draft) => {
    set((s) => {
      s.agentPhase = 'reviewing';
      s.agentPanelOpen = true;
      s.agentTargetArticleId = draft.articleId;
      s.agentPipelineType = draft.pipelineType as PipelineType;
      s.agentDraftResult = draft.draftContent;
    });
  },

  runAgentEstimate: async (worldId) => {
    const prevPhase = get().agentPhase;
    set((s) => { s.agentPhase = 'estimating'; });
    try {
      const { estimatedTokens } = await api.agents.estimate(worldId, {});
      set((s) => {
        s.agentEstimatedTokens = estimatedTokens;
        s.agentPhase = prevPhase === 'estimating' ? 'configuring' : prevPhase;
      });
    } catch {
      set((s) => { s.agentPhase = 'configuring'; });
    }
  },

  runAgentGenerate: async (worldId) => {
    const { agentPipelineType, agentTargetArticleId, agentParams } = get();
    if (!agentTargetArticleId) return;

    set((s) => { s.agentPhase = 'generating'; s.agentError = null; });

    try {
      switch (agentPipelineType) {
        case 'expand_description':
        case 'create_child':
        case 'reorganize': {
          const { proposals } = await api.agents.propose(worldId, {
            articleId: agentTargetArticleId,
            pipelineType: agentPipelineType,
            userSpec: agentParams.userSpec || undefined,
          });
          set((s) => { s.agentProposals = proposals; s.agentPhase = 'proposals_ready'; });
          break;
        }
        case 'propose_children': {
          const { proposals } = await api.agents.proposeChildren(worldId, { articleId: agentTargetArticleId });
          set((s) => { s.agentChildProposals = proposals; s.agentPhase = 'proposals_ready'; });
          break;
        }
        case 'expand_chronology': {
          const result = await api.agents.chronology(worldId, {
            articleId: agentTargetArticleId,
            userSpec: agentParams.userSpec || undefined,
          });
          set((s) => {
            s.agentDraftResult = {
              chronologySection: result.chronologySection,
              coherenceWarnings: result.coherenceWarnings as DraftContent['coherenceWarnings'],
            };
            s.agentPhase = 'reviewing';
          });
          break;
        }
        case 'summarize': {
          const result = await api.agents.summarize(worldId, { articleId: agentTargetArticleId });
          set((s) => { s.agentDraftResult = { introduction: result.introduction }; s.agentPhase = 'reviewing'; });
          break;
        }
        case 'cohere': {
          const result = await api.agents.cohere(worldId, { articleId: agentTargetArticleId });
          set((s) => {
            s.agentDraftResult = {
              coherenceWarnings: result.warnings as DraftContent['coherenceWarnings'],
              suggestedLinks: result.suggestedLinks as DraftContent['suggestedLinks'],
            };
            s.agentPhase = 'reviewing';
          });
          break;
        }
      }
    } catch (err) {
      set((s) => { s.agentPhase = 'error'; s.agentError = (err as Error).message; });
    }
  },

  runAgentExpand: async (worldId) => {
    const { agentTargetArticleId, agentPipelineType, agentProposals, agentSelectedProposalIndex, agentParams } = get();
    if (!agentTargetArticleId || agentSelectedProposalIndex === null) return;

    set((s) => { s.agentPhase = 'expanding'; s.agentError = null; });

    try {
      const result = await api.agents.expand(worldId, {
        articleId: agentTargetArticleId,
        pipelineType: agentPipelineType,
        selectedProposalIndex: agentSelectedProposalIndex,
        proposals: agentProposals,
        userSpec: agentParams.userSpec || undefined,
      });
      set((s) => {
        s.agentDraftResult = {
          description: result.description,
          introduction: result.introduction,
          coherenceWarnings: result.coherenceWarnings as DraftContent['coherenceWarnings'],
          suggestedLinks: result.suggestedLinks as DraftContent['suggestedLinks'],
        };
        s.agentPhase = 'reviewing';
      });
    } catch (err) {
      set((s) => { s.agentPhase = 'error'; s.agentError = (err as Error).message; });
    }
  },

  agentCommit: async (worldId) => {
    const { agentTargetArticleId, agentPipelineType, agentDraftResult } = get();
    if (!agentTargetArticleId) return;

    try {
      if (agentPipelineType === 'summarize') {
        await api.bible.updateEntry(worldId, agentTargetArticleId, agentDraftResult?.introduction ?? '');
        await get().loadBibleMeta(worldId);
        await get().selectArticle(worldId, agentTargetArticleId);
      } else if (agentPipelineType === 'cohere') {
        // Warnings are display-only — nothing to commit
      } else if (DRAFT_PIPELINES.includes(agentPipelineType)) {
        await get().acceptDraft(worldId, agentTargetArticleId);
        await get().loadTree(worldId);
      }

      get().addToast({ message: 'Content accepted.', type: 'success' });
      set((s) => {
        s.agentPhase = 'idle';
        s.agentPanelOpen = false;
        s.agentProposals = [];
        s.agentChildProposals = [];
        s.agentSelectedProposalIndex = null;
        s.agentDraftResult = null;
        s.agentEstimatedTokens = null;
      });
    } catch (err) {
      get().addToast({ message: (err as Error).message, type: 'error' });
      set((s) => { s.agentPhase = 'error'; s.agentError = (err as Error).message; });
    }
  },

  agentDiscard: async (worldId) => {
    const { agentTargetArticleId, agentPipelineType } = get();

    if (agentTargetArticleId && DRAFT_PIPELINES.includes(agentPipelineType)) {
      try {
        await get().discardDraft(worldId, agentTargetArticleId);
      } catch { /* ignore */ }
    }

    set((s) => {
      s.agentPhase = 'idle';
      s.agentPanelOpen = false;
      s.agentProposals = [];
      s.agentChildProposals = [];
      s.agentSelectedProposalIndex = null;
      s.agentDraftResult = null;
      s.agentError = null;
    });
  },

  agentBatchCreate: async (worldId, selectedIndices) => {
    const { agentTargetArticleId, agentChildProposals } = get();
    if (!agentTargetArticleId) return;

    const selected = selectedIndices.map((i) => agentChildProposals[i]).filter(Boolean);
    if (selected.length === 0) return;

    try {
      await api.articles.batch(worldId, {
        parentArticleId: agentTargetArticleId,
        children: selected.map((p) => ({
          title: p.title,
          introduction: p.introduction,
          templateType: p.templateType,
        })),
      });
      await get().loadTree(worldId);
      await get().selectArticle(worldId, agentTargetArticleId);
      get().addToast({
        message: `Created ${selected.length} subsection${selected.length > 1 ? 's' : ''}.`,
        type: 'success',
      });
      set((s) => {
        s.agentPhase = 'idle';
        s.agentPanelOpen = false;
        s.agentChildProposals = [];
        s.agentSelectedProposalIndex = null;
      });
    } catch (err) {
      get().addToast({ message: (err as Error).message, type: 'error' });
    }
  },
});
