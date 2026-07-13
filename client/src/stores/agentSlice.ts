import type { StateCreator } from 'zustand';
import type { StoreState } from './index.ts';
import { api } from '../lib/api.ts';
import type { ChildProposal, ContextDepth, SummarizerMode, IdeaItem, EdgeProposal, GlobalWarning, StyleWardenResult } from '../types/agent.ts';
import type { DraftContent } from '../types/article.ts';
import type { DraftContextBasis } from '../lib/api.ts';
import { defaultForgeRuntime } from './forgeSlice.ts';
export type { ForgeLogEntry } from './forgeSlice.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentPhase =
  | 'idle'
  | 'configuring'
  | 'estimating'
  | 'generating'
  | 'proposals_ready'
  | 'ideas_ready'
  | 'expanding'
  | 'reviewing'
  | 'continuing'
  | 'forging'
  | 'forge_done'
  | 'done'
  | 'error';

export type PipelineType =
  | 'expand_description'
  | 'create_child'
  | 'propose_children'
  | 'reorganize'
  | 'summarize'
  | 'improve_intro'
  | 'cohere'
  | 'forge_expand'
  | 'audit'
  | 'concept_scan'
  | 'fix_issue';

export type AgentPanelMode = 'spark' | 'solidification';
export type RunValidationLevel = 'manual' | 'assisted' | 'autopilot';

export interface NextStep {
  label: string;
  pipeline: PipelineType;
  description: string;
}

export interface AgentParams {
  wordCountPreset: 'short' | 'medium' | 'long';
  detailDepth: 'surface' | 'detailed' | 'exhaustive';
  breadth: 'focused' | 'connected';
  userSpec: string;
  contextDepth: ContextDepth;
  contextBasis: DraftContextBasis;
  autoSelect: boolean;
  summarizerMode: SummarizerMode;
  branchingMode: 'conceptual' | 'specific';
  includeCurrentContent: boolean;
  autoChain: boolean;
  // Recursive forge params
  forgeEnabled: boolean;
  forgeMode: 'breadth' | 'depth';
  forgeMaxDepth: number;    // 1–3 extra levels below start node
  forgeMaxChildren: number; // 0 = all, otherwise take top N
  // One global dial covering Continuity Editor (Scribe), Grounding Check
  // (Lorekeeper), and Dedup Check (Cartographer): 0 = off, N = up to N
  // check→revise cycles.
  coherenceCheckLevel: number;
  safetyNet: boolean; // one final check-only pass after coherenceCheckLevel cycles; flags but never blocks
  forgeContinuationMode: 'one_step' | 'finish_document' | 'recursive';
  runValidationLevel: RunValidationLevel;
  forgeInceptionExistingMode: 'create' | 'improve' | 'replace' | 'skip_existing';
  forgeExpansionExistingMode: 'create' | 'improve' | 'replace' | 'skip_existing';
  forgeBranchingExistingMode: 'append_deduped' | 'skip_if_children';
}

const defaultParams: AgentParams = {
  wordCountPreset:      'medium',
  detailDepth:          'detailed',
  breadth:              'focused',
  userSpec:             '',
  contextDepth:         'mid',
  contextBasis:         'current',
  autoSelect:           false,
  summarizerMode:       'full',
  branchingMode:        'conceptual',
  includeCurrentContent: true,
  autoChain:            false,
  forgeEnabled:         false,
  forgeMode:            'breadth',
  forgeMaxDepth:        2,
  forgeMaxChildren:     5,
  coherenceCheckLevel:        1,
  safetyNet:                  false,
  forgeContinuationMode:      'recursive',
  runValidationLevel:         'autopilot',
  forgeInceptionExistingMode: 'improve',
  forgeExpansionExistingMode: 'improve',
  forgeBranchingExistingMode: 'append_deduped',
};

export const defaultAgentRuntime: Pick<
  AgentSlice,
  | 'agentChildProposals'
  | 'agentDraftResult'
  | 'agentEstimatedTokens'
  | 'agentError'
  | 'agentNextSteps'
  | 'agentIdeas'
  | 'agentSelectedIdeas'
  | 'agentStyleCheck'
  | 'agentAuditEdgeProposals'
  | 'agentAuditGlobalWarnings'
  | 'agentLoadedDraftId'
> = {
  agentChildProposals: [],
  agentDraftResult: null,
  agentEstimatedTokens: null,
  agentError: null,
  agentNextSteps: [],
  agentIdeas: [],
  agentSelectedIdeas: [],
  agentStyleCheck: null,
  agentAuditEdgeProposals: [],
  agentAuditGlobalWarnings: [],
  agentLoadedDraftId: null,
};

// Pipelines that save a pending_draft on the server and commit via POST /accept
const DRAFT_PIPELINE_MAP: Record<PipelineType, boolean> = {
  expand_description: true,
  create_child: true,
  reorganize: true,
  forge_expand: true,
  propose_children: false,
  summarize: false,
  improve_intro: false,
  cohere: false,
  audit: false,
  concept_scan: false,
  fix_issue: false,
};

// ---------------------------------------------------------------------------
// Continuation step suggestion logic
// ---------------------------------------------------------------------------

function suggestNextSteps(
  pipelineType: PipelineType,
  panelMode: AgentPanelMode,
  draftResult: DraftContent | null,
): NextStep[] {
  if (panelMode !== 'spark') return [];

  if (pipelineType === 'summarize' || pipelineType === 'improve_intro') {
    if (draftResult?.introduction) {
      return [{ label: 'Expand Description', pipeline: 'forge_expand', description: 'Write the full description using creative proposals.' }];
    }
  }
  if (pipelineType === 'forge_expand' || pipelineType === 'expand_description' || pipelineType === 'create_child' || pipelineType === 'reorganize') {
    return [{ label: 'Branch Children', pipeline: 'propose_children', description: '10 child article ideas to pick from.' }];
  }
  // propose_children is the last Spark step — no further suggestions
  return [];
}

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface AgentSlice {
  agentPhase: AgentPhase;
  agentPanelOpen: boolean;
  agentPanelMode: AgentPanelMode;
  agentTargetArticleId: string | null;
  agentTargetArticleTitle: string | null;
  agentPipelineType: PipelineType;
  agentParams: AgentParams;
  agentChildProposals: ChildProposal[];
  agentDraftResult: DraftContent | null;
  agentEstimatedTokens: number | null;
  agentError: string | null;
  agentNextSteps: NextStep[];
  agentIdeas: IdeaItem[];
  agentSelectedIdeas: IdeaItem[];
  agentStyleCheck: StyleWardenResult | null;
  agentAuditEdgeProposals: EdgeProposal[];
  agentAuditGlobalWarnings: GlobalWarning[];
  agentLoadedDraftId: string | null;

  openAgentPanel: (articleId: string | null, articleTitle: string | null, mode: AgentPanelMode, pipeline?: PipelineType) => void;
  closeAgentPanel: () => void;
  setAgentPipelineType: (type: PipelineType) => void;
  setAgentParams: (params: Partial<AgentParams>) => void;
  toggleAgentIdea: (idea: IdeaItem) => void;
  clearAgentIdeas: () => void;
  agentRetry: () => void;
  continueWithStep: (step: NextStep) => void;
  startAudit: (worldId: string) => Promise<void>;

  runAgentEstimate: (worldId: string) => Promise<void>;
  runAgentGenerate: (worldId: string) => Promise<void>;
  runAgentExpand: (worldId: string) => Promise<void>;
  agentCommit: (worldId: string) => Promise<void>;
  agentDiscard: (worldId: string) => Promise<void>;
  agentBatchCreate: (worldId: string, selectedIndices: number[]) => Promise<void>;
  dispatchSolidify: (worldId: string, articleId: string, articleTitle: string, pipeline: 'cohere' | 'reorganize') => Promise<void>;
}

// ---------------------------------------------------------------------------
// Slice implementation
// ---------------------------------------------------------------------------

export const agentSlice: StateCreator<StoreState, [['zustand/immer', never]], [], AgentSlice> = (set, get) => {
  return {
    agentPhase: 'idle',
    agentPanelOpen: false,
    agentPanelMode: 'spark',
    agentTargetArticleId: null,
    agentTargetArticleTitle: null,
    agentPipelineType: 'summarize',
    agentParams: { ...defaultParams },
    ...defaultAgentRuntime,

    openAgentPanel: (articleId, articleTitle, mode, pipeline) => {
      const defaultPipeline = mode === 'spark' ? 'summarize' : 'reorganize';
      set((s) => {
        Object.assign(s, defaultAgentRuntime, defaultForgeRuntime);
        s.agentPhase = 'configuring';
        s.agentPanelOpen = true;
        s.agentPanelMode = mode;
        s.agentTargetArticleId = articleId;
        s.agentTargetArticleTitle = articleTitle;
        s.agentPipelineType = pipeline ?? defaultPipeline;
        s.agentParams = { ...defaultParams };
      });
    },

    closeAgentPanel: () => {
      set((s) => {
        Object.assign(s, defaultAgentRuntime, defaultForgeRuntime);
        s.agentPhase = 'idle';
        s.agentPanelOpen = false;
      });
    },

    setAgentPipelineType: (type) => {
      set((s) => {
        s.agentPipelineType = type;
        s.agentChildProposals = [];
        s.agentDraftResult = null;
      });
    },

    setAgentParams: (params) => {
      set((s) => { Object.assign(s.agentParams, params); });
    },

    toggleAgentIdea: (idea) => {
      set((s) => {
        const idx = s.agentSelectedIdeas.findIndex((i) => i.id === idea.id);
        if (idx >= 0) {
          s.agentSelectedIdeas.splice(idx, 1);
        } else {
          s.agentSelectedIdeas.push(idea);
        }
      });
    },

    clearAgentIdeas: () => {
      set((s) => { s.agentSelectedIdeas = []; });
    },

    agentRetry: () => {
      set((s) => {
        Object.assign(s, defaultAgentRuntime);
        s.agentPhase = 'configuring';
      });
    },

    continueWithStep: (step) => {
      set((s) => {
        Object.assign(s, defaultAgentRuntime);
        s.agentPipelineType = step.pipeline;
        s.agentPhase = 'configuring';
        s.agentParams = { ...defaultParams };
      });
    },

    startAudit: async (worldId) => {
      set((s) => {
        s.agentPhase = 'generating';
        s.agentPanelOpen = true;
        s.agentPanelMode = 'spark';
        s.agentPipelineType = 'audit';
        s.agentTargetArticleId = null;
        s.agentTargetArticleTitle = null;
        s.agentError = null;
        s.agentAuditEdgeProposals = [];
        s.agentAuditGlobalWarnings = [];
        s.agentDraftResult = null;
      });
      try {
        const result = await api.agents.audit(worldId);
        set((s) => {
          s.agentAuditEdgeProposals = result.edgeProposals;
          s.agentAuditGlobalWarnings = result.globalWarnings;
          s.agentDraftResult = {};
          s.agentPhase = 'reviewing';
        });
      } catch (err) {
        set((s) => { s.agentPhase = 'error'; s.agentError = (err as Error).message; });
      }
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
          case 'reorganize': {
            // Reorganize has its own dedicated endpoint/pipeline (Scribe [reorganize] ->
            // Sentinel -> Lorekeeper) — no proposal step, so call it directly instead of
            // faking a proposal through the generic /expand endpoint.
            const result = await api.agents.reorganize(worldId, {
              articleId:    agentTargetArticleId,
              userSpec:     agentParams.userSpec || undefined,
              contextDepth: agentParams.contextDepth,
              contextBasis: agentParams.contextBasis,
            });
            set((s) => {
              s.agentDraftResult = {
                description:      result.description,
                introduction:     result.introduction,
                retentionIssues:  result.retentionIssues,
              };
              s.agentLoadedDraftId = result.draft?.id ?? null;
              s.agentPhase = 'reviewing';
            });
            break;
          }
          case 'expand_description':
          case 'create_child': {
            const result = await api.agents.propose(worldId, {
              articleId:    agentTargetArticleId,
              pipelineType: agentPipelineType,
              userSpec:     agentParams.userSpec || undefined,
              autoSelect:   agentParams.autoSelect,
              contextDepth: agentParams.contextDepth,
              contextBasis: agentParams.contextBasis,
            });
            set((s) => { s.agentIdeas = result.ideas; });

            if (agentParams.autoSelect && result.autoSelectedIndices !== undefined) {
              const indices = result.autoSelectedIndices;
              set((s) => {
                s.agentSelectedIdeas = indices.map((i) => result.ideas[i]).filter((idea): idea is IdeaItem => Boolean(idea));
                s.agentPhase = 'expanding';
              });
              get().runAgentExpand(worldId).catch(console.error);
            } else {
              set((s) => { s.agentSelectedIdeas = [...result.ideas]; s.agentPhase = 'ideas_ready'; });
            }
            break;
          }
          case 'propose_children': {
            const { agentTargetArticleTitle: parentTitle } = get();
            const branchHint = agentParams.branchingMode === 'specific'
              ? 'Propose specific named instances — individual entities, characters, places, groups, or events that concretely exist in this world. '
              : `Propose top-level conceptual domain categories (e.g. Technology, Religion, Geography, Nations, Culture, Economy, Magic System, Law). Title each child as "${parentTitle ?? 'Parent'} [Category]" (e.g. "${parentTitle ?? 'Parent'} Religion", "${parentTitle ?? 'Parent'} Geography") unless this is the world root article, in which case use bare category names (e.g. "Religion", "Geography"). `;
            const userSpec = branchHint + (agentParams.userSpec ?? '');

            const { proposals } = await api.agents.proposeChildren(worldId, {
              articleId:    agentTargetArticleId,
              userSpec:     userSpec.trim() || undefined,
              contextDepth: agentParams.contextDepth,
              contextBasis: agentParams.contextBasis,
            });
            set((s) => { s.agentChildProposals = proposals; s.agentPhase = 'proposals_ready'; });
            break;
          }
          case 'summarize': {
            const mode = agentParams.includeCurrentContent ? 'improve' : 'full';
            const result = await api.agents.summarize(worldId, {
              articleId: agentTargetArticleId,
              mode,
            });
            set((s) => { s.agentDraftResult = { introduction: result.introduction }; s.agentPhase = 'reviewing'; });
            break;
          }
          case 'improve_intro': {
            const result = await api.agents.summarize(worldId, {
              articleId: agentTargetArticleId,
              mode:      'improve',
            });
            set((s) => { s.agentDraftResult = { introduction: result.introduction }; s.agentPhase = 'reviewing'; });
            break;
          }
          case 'cohere': {
            const result = await api.agents.cohere(worldId, {
              articleId:    agentTargetArticleId,
              contextDepth: agentParams.contextDepth,
              contextBasis: agentParams.contextBasis,
            });
            set((s) => {
              s.agentDraftResult = {
                coherenceWarnings: result.warnings as DraftContent['coherenceWarnings'],
                suggestedLinks:    result.suggestedLinks as DraftContent['suggestedLinks'],
              };
              s.agentPhase = 'reviewing';
            });
            break;
          }
          case 'forge_expand': {
            const result = await api.agents.propose(worldId, {
              articleId:    agentTargetArticleId,
              pipelineType: 'expand_description',
              userSpec:     agentParams.userSpec || undefined,
              autoSelect:   agentParams.autoSelect,
              contextDepth: agentParams.contextDepth,
              contextBasis: agentParams.contextBasis,
            });
            set((s) => { s.agentIdeas = result.ideas; });

            if (agentParams.autoSelect && result.autoSelectedIndices !== undefined) {
              const indices = result.autoSelectedIndices;
              set((s) => {
                s.agentSelectedIdeas = indices.map((i) => result.ideas[i]).filter((idea): idea is IdeaItem => Boolean(idea));
                s.agentPhase = 'expanding';
              });
              get().runAgentExpand(worldId).catch(console.error);
            } else {
              set((s) => { s.agentSelectedIdeas = [...result.ideas]; s.agentPhase = 'ideas_ready'; });
            }
            break;
          }
          case 'audit': {
            const result = await api.agents.audit(worldId);
            set((s) => {
              s.agentAuditEdgeProposals = result.edgeProposals;
              s.agentAuditGlobalWarnings = result.globalWarnings;
              s.agentDraftResult = {};
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
      const { agentTargetArticleId, agentPipelineType, agentParams, agentSelectedIdeas } = get();
      if (!agentTargetArticleId) return;

      set((s) => { s.agentPhase = 'expanding'; s.agentError = null; });

      try {
        const result = await api.agents.expand(worldId, {
          articleId:       agentTargetArticleId,
          pipelineType:    agentPipelineType === 'forge_expand' ? 'expand_description' : agentPipelineType,
          selectedIdeas:   agentSelectedIdeas,
          userSpec:        agentParams.userSpec || undefined,
          contextDepth:    agentParams.contextDepth,
          contextBasis:    agentParams.contextBasis,
          wordCountPreset: agentParams.wordCountPreset,
        });
        set((s) => {
          s.agentDraftResult = {
            description:  result.description,
            introduction: result.introduction,
          };
          if (result.styleCheck) {
            s.agentStyleCheck = result.styleCheck;
          }
          s.agentLoadedDraftId = result.draft?.id ?? null;
          s.agentPhase = 'reviewing';
        });
      } catch (err) {
        set((s) => { s.agentPhase = 'error'; s.agentError = (err as Error).message; });
      }
    },

    agentCommit: async (worldId) => {
      const { agentTargetArticleId, agentPipelineType, agentDraftResult, agentPanelMode, agentParams, agentLoadedDraftId } = get();
      if (!agentTargetArticleId) return;

      try {
        if (agentPipelineType === 'summarize' || agentPipelineType === 'improve_intro') {
          await api.bible.updateEntry(worldId, agentTargetArticleId, agentDraftResult?.introduction ?? '');
          await get().loadBibleMeta(worldId);
          await get().selectArticle(worldId, agentTargetArticleId);
        } else if (agentPipelineType === 'cohere') {
          // Warnings are display-only — nothing to commit
        } else if (DRAFT_PIPELINE_MAP[agentPipelineType]) {
          await get().acceptDraft(worldId, agentTargetArticleId, agentLoadedDraftId ?? undefined);
          await get().loadTree(worldId);
        }

        get().addToast({ message: 'Content accepted.', type: 'success' });

        const nextSteps = suggestNextSteps(agentPipelineType, agentPanelMode, agentDraftResult);

        // Auto-chain: skip ContinuationView and start next Spark step immediately
        if (agentPanelMode === 'spark' && agentParams.autoChain && nextSteps.length > 0) {
          const next = nextSteps[0];
          set((s) => {
            Object.assign(s, defaultAgentRuntime);
            s.agentPipelineType = next.pipeline;
          });
          get().runAgentGenerate(worldId).catch(console.error);
          return;
        }

        set((s) => {
          Object.assign(s, defaultAgentRuntime);

          if (agentPanelMode === 'spark' && nextSteps.length > 0) {
            // Return to SparkConfigView with the next task pre-selected
            s.agentPipelineType = nextSteps[0].pipeline;
            s.agentNextSteps = [];
            s.agentPhase = 'configuring';
          } else if (agentPanelMode === 'spark') {
            // All Spark steps done — close panel
            s.agentPhase = 'idle';
            s.agentPanelOpen = false;
            s.agentNextSteps = [];
          } else if (nextSteps.length > 0) {
            s.agentNextSteps = nextSteps;
            s.agentPhase = 'continuing';
          } else {
            s.agentPhase = 'idle';
            s.agentPanelOpen = false;
            s.agentNextSteps = [];
          }
        });
      } catch (err) {
        get().addToast({ message: (err as Error).message, type: 'error' });
        set((s) => { s.agentPhase = 'error'; s.agentError = (err as Error).message; });
      }
    },

    agentDiscard: async (worldId) => {
      const { agentTargetArticleId, agentPipelineType, agentLoadedDraftId } = get();

      if (agentTargetArticleId && DRAFT_PIPELINE_MAP[agentPipelineType]) {
        try {
          await get().discardDraft(worldId, agentTargetArticleId, agentLoadedDraftId ?? undefined);
        } catch { /* ignore */ }
      }

      set((s) => {
        Object.assign(s, defaultAgentRuntime);
        s.agentPhase = 'idle';
        s.agentPanelOpen = false;
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
            title:        p.title,
            introduction: p.introduction,
            templateType: p.templateType as 'general' | 'character' | 'location' | 'faction' | 'historical_event',
          })),
        });
        await get().loadTree(worldId);
        await get().selectArticle(worldId, agentTargetArticleId);
        get().addToast({
          message: `Created ${selected.length} child subject${selected.length > 1 ? 's' : ''}.`,
          type: 'success',
        });
        set((s) => {
          s.agentPhase = 'idle';
          s.agentPanelOpen = false;
          s.agentChildProposals = [];
          s.agentNextSteps = [];
        });
      } catch (err) {
        get().addToast({ message: (err as Error).message, type: 'error' });
      }
    },

    dispatchSolidify: async (worldId, articleId, articleTitle, pipeline) => {
      await get().selectArticle(worldId, articleId);
      get().openAgentPanel(articleId, articleTitle, 'solidification', pipeline);
      get().runAgentGenerate(worldId).catch(console.error);
    },
  };
};
