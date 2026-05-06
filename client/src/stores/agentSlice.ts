import type { StateCreator } from 'zustand';
import type { StoreState } from './index.ts';
import { api } from '../lib/api.ts';
import type { Proposal, ChildProposal, ContextDepth, SummarizerMode, IdeaItem, EdgeProposal, GlobalWarning, StyleWardenResult } from '../types/agent.ts';
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
  | 'expand_chronology'
  | 'reorganize'
  | 'summarize'
  | 'improve_intro'
  | 'cohere'
  | 'forge_expand'
  | 'audit';

export type AgentPanelMode = 'spark' | 'solidification';

export interface NextStep {
  label: string;
  pipeline: PipelineType;
  description: string;
}

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

export interface AgentParams {
  wordCountPreset: 'short' | 'medium' | 'long';
  detailDepth: 'surface' | 'detailed' | 'exhaustive';
  breadth: 'focused' | 'connected';
  userSpec: string;
  contextDepth: ContextDepth;
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
}

const defaultParams: AgentParams = {
  wordCountPreset:      'medium',
  detailDepth:          'detailed',
  breadth:              'focused',
  userSpec:             '',
  contextDepth:         'mid',
  autoSelect:           false,
  summarizerMode:       'full',
  branchingMode:        'conceptual',
  includeCurrentContent: true,
  autoChain:            false,
  forgeEnabled:         false,
  forgeMode:            'breadth',
  forgeMaxDepth:        2,
  forgeMaxChildren:     5,
};

// Pipelines that save a pending_draft on the server and commit via POST /accept
const DRAFT_PIPELINES: PipelineType[] = [
  'expand_description',
  'create_child',
  'expand_chronology',
  'reorganize',
  'forge_expand',
];

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
  agentProposals: Proposal[];
  agentChildProposals: ChildProposal[];
  agentSelectedProposalIndex: number | null;
  agentDraftResult: DraftContent | null;
  agentEstimatedTokens: number | null;
  agentError: string | null;
  agentNextSteps: NextStep[];
  agentIdeas: IdeaItem[];
  agentSelectedIdeas: IdeaItem[];
  agentStyleCheck: StyleWardenResult | null;
  agentAuditEdgeProposals: EdgeProposal[];
  agentAuditGlobalWarnings: GlobalWarning[];

  // Recursive forge state
  forgeRunning: boolean;
  forgePaused: boolean;
  forgeQueue: ForgeItem[];
  forgeLog: ForgeLogEntry[];
  forgeCurrentTitle: string | null;
  forgeCurrentStep: string | null;
  forgeCompleted: number;
  forgeTotal: number;

  openAgentPanel: (articleId: string | null, articleTitle: string | null, mode: AgentPanelMode, pipeline?: PipelineType) => void;
  closeAgentPanel: () => void;
  setAgentPipelineType: (type: PipelineType) => void;
  setAgentParams: (params: Partial<AgentParams>) => void;
  selectAgentProposal: (index: number) => void;
  editAgentProposalDirection: (index: number, direction: string) => void;
  toggleAgentIdea: (idea: IdeaItem) => void;
  clearAgentIdeas: () => void;
  backToProposals: () => void;
  agentRetry: () => void;
  loadDraftIntoPanel: (draft: PendingDraft) => void;
  continueWithStep: (step: NextStep) => void;
  startAudit: (worldId: string) => Promise<void>;
  startForge: (worldId: string) => Promise<void>;
  pauseForge: () => void;
  resumeForge: (worldId: string) => Promise<void>;
  stopForge: () => void;

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

export const agentSlice: StateCreator<StoreState, [['zustand/immer', never]], [], AgentSlice> = (set, get) => {

  // ── Recursive forge loop ──────────────────────────────────────────────────
  // Runs as long as the queue is non-empty and forge is not paused/stopped.
  // Processes each article through Inception → Expansion → Branching.
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
              s.forgeQueue.push(...newItems);         // BFS: children go to the back
            } else {
              s.forgeQueue.unshift(...newItems);      // DFS: children go to the front
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
        // Continue with the next item — don't halt the whole forge
      }

      set((s) => { s.forgeCompleted++; });
    }

    // ── Loop ended ────────────────────────────────────────────────────────
    const finalState = get();
    if (finalState.forgeRunning && !finalState.forgePaused) {
      // Queue is empty — forge completed naturally
      await get().loadTree(worldId).catch(console.error);
      set((s) => {
        s.forgeRunning       = false;
        s.forgeCurrentTitle  = null;
        s.forgeCurrentStep   = null;
        s.agentPhase         = 'forge_done';
      });
    }
  };

  // ── Slice return ──────────────────────────────────────────────────────────
  return {
    agentPhase: 'idle',
    agentPanelOpen: false,
    agentPanelMode: 'spark',
    agentTargetArticleId: null,
    agentTargetArticleTitle: null,
    agentPipelineType: 'summarize',
    agentParams: { ...defaultParams },
    agentProposals: [],
    agentChildProposals: [],
    agentSelectedProposalIndex: null,
    agentDraftResult: null,
    agentEstimatedTokens: null,
    agentError: null,
    agentNextSteps: [],
    agentIdeas: [],
    agentSelectedIdeas: [],
    agentStyleCheck: null,
    agentAuditEdgeProposals: [],
    agentAuditGlobalWarnings: [],

    forgeRunning: false,
    forgePaused: false,
    forgeQueue: [],
    forgeLog: [],
    forgeCurrentTitle: null,
    forgeCurrentStep: null,
    forgeCompleted: 0,
    forgeTotal: 0,

    openAgentPanel: (articleId, articleTitle, mode, pipeline) => {
      const defaultPipeline = mode === 'spark' ? 'summarize' : 'reorganize';
      set((s) => {
        s.agentPhase = 'configuring';
        s.agentPanelOpen = true;
        s.agentPanelMode = mode;
        s.agentTargetArticleId = articleId;
        s.agentTargetArticleTitle = articleTitle;
        s.agentPipelineType = pipeline ?? defaultPipeline;
        s.agentProposals = [];
        s.agentChildProposals = [];
        s.agentSelectedProposalIndex = null;
        s.agentDraftResult = null;
        s.agentEstimatedTokens = null;
        s.agentError = null;
        s.agentNextSteps = [];
        s.agentIdeas = [];
        s.agentSelectedIdeas = [];
        s.agentStyleCheck = null;
        s.agentAuditEdgeProposals = [];
        s.agentAuditGlobalWarnings = [];
        s.agentParams = { ...defaultParams };
        s.forgeRunning = false;
        s.forgePaused = false;
        s.forgeQueue = [];
        s.forgeLog = [];
        s.forgeCurrentTitle = null;
        s.forgeCurrentStep = null;
        s.forgeCompleted = 0;
        s.forgeTotal = 0;
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
        s.agentNextSteps = [];
        s.agentIdeas = [];
        s.agentSelectedIdeas = [];
        s.agentStyleCheck = null;
        s.agentAuditEdgeProposals = [];
        s.agentAuditGlobalWarnings = [];
        s.forgeRunning = false;
        s.forgePaused = false;
        s.forgeQueue = [];
        s.forgeLog = [];
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

    editAgentProposalDirection: (index, direction) => {
      set((s) => {
        if (s.agentProposals[index]) {
          s.agentProposals[index].direction = direction;
        }
      });
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

    backToProposals: () => {
      set((s) => {
        s.agentIdeas = [];
        s.agentSelectedIdeas = [];
        s.agentPhase = 'proposals_ready';
      });
    },

    agentRetry: () => {
      set((s) => {
        s.agentPhase = 'configuring';
        s.agentError = null;
        s.agentProposals = [];
        s.agentChildProposals = [];
        s.agentSelectedProposalIndex = null;
        s.agentDraftResult = null;
        s.agentNextSteps = [];
      });
    },

    loadDraftIntoPanel: (draft) => {
      set((s) => {
        s.agentPhase = 'reviewing';
        s.agentPanelOpen = true;
        s.agentPanelMode = 'spark';
        s.agentTargetArticleId = draft.articleId;
        s.agentPipelineType = draft.pipelineType as PipelineType;
        s.agentDraftResult = draft.draftContent;
      });
    },

    continueWithStep: (step) => {
      set((s) => {
        s.agentPipelineType = step.pipeline;
        s.agentPhase = 'configuring';
        s.agentProposals = [];
        s.agentChildProposals = [];
        s.agentSelectedProposalIndex = null;
        s.agentDraftResult = null;
        s.agentNextSteps = [];
        s.agentError = null;
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
            // Reorganize has no proposal step — the existing article body is the constraint.
            // Go directly to expanding with a dummy selectedProposalIndex.
            set((s) => {
              s.agentProposals = [];
              s.agentSelectedProposalIndex = 0;
              s.agentPhase = 'expanding';
            });
            get().runAgentExpand(worldId).catch(console.error);
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
            });
            set((s) => { s.agentProposals = result.proposals; });

            if (agentParams.autoSelect && result.autoSelectedIndex !== undefined) {
              set((s) => {
                s.agentSelectedProposalIndex = result.autoSelectedIndex!;
                s.agentPhase = 'expanding';
              });
              get().runAgentExpand(worldId).catch(console.error);
            } else {
              set((s) => { s.agentPhase = 'proposals_ready'; });
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
            });
            set((s) => { s.agentChildProposals = proposals; s.agentPhase = 'proposals_ready'; });
            break;
          }
          case 'expand_chronology': {
            const result = await api.agents.chronology(worldId, {
              articleId:    agentTargetArticleId,
              userSpec:     agentParams.userSpec || undefined,
              contextDepth: agentParams.contextDepth,
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
            });
            set((s) => { s.agentProposals = result.proposals; });

            if (agentParams.autoSelect && result.autoSelectedIndex !== undefined) {
              set((s) => {
                s.agentSelectedProposalIndex = result.autoSelectedIndex!;
                s.agentPhase = 'expanding';
              });
              get().runAgentExpand(worldId).catch(console.error);
            } else {
              set((s) => { s.agentPhase = 'proposals_ready'; });
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
      const { agentTargetArticleId, agentPipelineType, agentProposals, agentSelectedProposalIndex, agentParams, agentIdeas, agentSelectedIdeas } = get();
      if (!agentTargetArticleId || agentSelectedProposalIndex === null) return;

      set((s) => { s.agentPhase = 'expanding'; s.agentError = null; });

      try {
        if (agentPipelineType === 'forge_expand' && agentIdeas.length === 0) {
          const introduction = get().currentArticleDetail?.introduction ?? '';
          const selectedProposal = agentProposals[agentSelectedProposalIndex];
          const { ideas } = await api.agents.proposeIdeas(worldId, {
            articleId:    agentTargetArticleId,
            introduction,
            selectedProposal,
            userSpec:     agentParams.userSpec || undefined,
            contextDepth: agentParams.contextDepth,
          });
          set((s) => {
            s.agentIdeas = ideas;
            s.agentSelectedIdeas = [...ideas];
            s.agentPhase = 'ideas_ready';
          });
        } else {
          const result = await api.agents.expand(worldId, {
            articleId:             agentTargetArticleId,
            pipelineType:          agentPipelineType === 'forge_expand' ? 'expand_description' : agentPipelineType,
            selectedProposalIndex: agentSelectedProposalIndex,
            proposals:             agentProposals,
            userSpec:              agentParams.userSpec || undefined,
            contextDepth:          agentParams.contextDepth,
            selectedIdeas:         agentPipelineType === 'forge_expand' ? agentSelectedIdeas : undefined,
          });
          set((s) => {
            s.agentDraftResult = {
              description:  result.description,
              introduction: result.introduction,
            };
            if (result.styleCheck) {
              s.agentStyleCheck = result.styleCheck;
            }
            s.agentPhase = 'reviewing';
          });
        }
      } catch (err) {
        set((s) => { s.agentPhase = 'error'; s.agentError = (err as Error).message; });
      }
    },

    agentCommit: async (worldId) => {
      const { agentTargetArticleId, agentPipelineType, agentDraftResult, agentPanelMode, agentParams } = get();
      if (!agentTargetArticleId) return;

      try {
        if (agentPipelineType === 'summarize' || agentPipelineType === 'improve_intro') {
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

        const nextSteps = suggestNextSteps(agentPipelineType, agentPanelMode, agentDraftResult);

        // Auto-chain: skip ContinuationView and start next Spark step immediately
        if (agentPanelMode === 'spark' && agentParams.autoChain && nextSteps.length > 0) {
          const next = nextSteps[0];
          set((s) => {
            s.agentPipelineType = next.pipeline;
            s.agentProposals = [];
            s.agentChildProposals = [];
            s.agentSelectedProposalIndex = null;
            s.agentDraftResult = null;
            s.agentEstimatedTokens = null;
            s.agentNextSteps = [];
            s.agentIdeas = [];
            s.agentSelectedIdeas = [];
            s.agentStyleCheck = null;
            s.agentError = null;
          });
          get().runAgentGenerate(worldId).catch(console.error);
          return;
        }

        set((s) => {
          s.agentDraftResult = null;
          s.agentProposals = [];
          s.agentChildProposals = [];
          s.agentSelectedProposalIndex = null;
          s.agentEstimatedTokens = null;
          s.agentIdeas = [];
          s.agentSelectedIdeas = [];
          s.agentStyleCheck = null;
          s.agentError = null;

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
        s.agentNextSteps = [];
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
          message: `Created ${selected.length} subsection${selected.length > 1 ? 's' : ''}.`,
          type: 'success',
        });
        set((s) => {
          s.agentPhase = 'idle';
          s.agentPanelOpen = false;
          s.agentChildProposals = [];
          s.agentSelectedProposalIndex = null;
          s.agentNextSteps = [];
        });
      } catch (err) {
        get().addToast({ message: (err as Error).message, type: 'error' });
      }
    },
  };
};
