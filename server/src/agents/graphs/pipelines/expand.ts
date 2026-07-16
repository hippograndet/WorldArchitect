import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { fetchWorldContextNode, buildContextPackageNode } from '../nodes/shared.js';
import { researcherNode } from '../nodes/expand/research.js';
import { scribeNode, deriveIntroFromChildDescriptionNode, stylizerNode } from '../nodes/expand/draft.js';
import { articleContract, contractState, expanderIntent } from '../masContract.js';
import type { ContextDepth, ArchivistMode, ContextPackage, WorldInfoContext } from '../../../services/archivist.js';
import type { DraftContextBasis } from '../../../services/draftsService.js';
import type { ExpanderMode } from '../../../prompts/expander.js';
import type { IdeaItem } from '../../muse.js';
import type { ResearchBrief } from '../../scribe.js';
import type { StylizerOutput } from '../../stylizer.js';
import type { ArbiterOutput } from '../../arbiter.js';
import type { WorldContext } from '../../director.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('researcher', researcherNode)
  .addNode('scribe', scribeNode)
  .addNode('deriveIntroFromChildDescription', deriveIntroFromChildDescriptionNode)
  .addNode('stylizer', stylizerNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'researcher')
  .addEdge('researcher', 'scribe')
  .addEdge('scribe', 'stylizer')
  .addEdge('stylizer', 'deriveIntroFromChildDescription')
  .addEdge('deriveIntroFromChildDescription', '__end__')
  .compile();

export interface ExpandGraphOutput {
  description: string;
  introduction?: string;
  parentUpdate?: { appendText: string };
  styleCheck?: StylizerOutput;
  arbiterCheck?: ArbiterOutput;
  contextDraftIds: string[];
  tokensIn: number;
  tokensOut: number;
}

export async function runExpandGraph(params: {
  worldId: string;
  ownerId?: string;
  articleId: string;
  pipelineType: ExpanderMode;
  userSpec?: string;
  /** Only meaningful for pipelineType 'expand_description' — see ScribeInput's scribeMode doc. */
  scribeMode?: 'full' | 'improve';
  contextDepth?: ContextDepth;
  contextBasis?: DraftContextBasis;
  selectedIdeas?: IdeaItem[];
  runStylizer?: boolean;
  coherenceCheckLevel?: number;
  safetyNet?: boolean;
  wordCountPreset?: 'short' | 'medium' | 'long';
  pipelineRunId?: string;
  worldContext?: WorldContext;
  worldInfoContext?: WorldInfoContext;
  /**
   * Only honored when this call's own contextMode resolves to 'default' — a
   * package built under a different ArchivistMode (e.g. 'reorganize') would
   * be missing/extra tiers this call expects. See buildContextPackageNode's
   * guard comment in nodes.ts for the underlying invariant.
   */
  contextPackage?: ContextPackage;
  researchBrief?: ResearchBrief;
}): Promise<ExpandGraphOutput> {
  const contextMode: ArchivistMode = params.pipelineType === 'reorganize' ? 'reorganize' : 'default';
  const cachedContextPackage = contextMode === 'default' ? params.contextPackage : undefined;

  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'expand',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: expanderIntent(params.pipelineType),
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
    })),
    expanderMode: params.pipelineType,
    userSpec: params.userSpec,
    scribeMode: params.scribeMode ?? 'full',
    contextDepth: params.contextDepth ?? 'mid',
    contextBasis: params.contextBasis ?? 'current',
    contextMode,
    selectedIdeas: params.selectedIdeas,
    runStylizer: params.runStylizer ?? false,
    coherenceCheckLevel: params.coherenceCheckLevel ?? 0,
    safetyNet: params.safetyNet ?? false,
    wordCountPreset: params.wordCountPreset ?? 'medium',
    ...(params.worldContext ? { worldContext: params.worldContext } : {}),
    ...(params.worldInfoContext ? { worldInfoContext: params.worldInfoContext } : {}),
    ...(cachedContextPackage ? { contextPackage: cachedContextPackage } : {}),
    ...(params.researchBrief ? { researchBrief: params.researchBrief } : {}),
  });

  return {
    description: result.description!,
    ...(result.introduction !== undefined ? { introduction: result.introduction } : {}),
    ...(result.parentUpdate ? { parentUpdate: result.parentUpdate } : {}),
    ...(result.styleCheck ? { styleCheck: result.styleCheck } : {}),
    ...(result.arbiterCheck ? { arbiterCheck: result.arbiterCheck } : {}),
    contextDraftIds: result.contextPackage?.contextDraftIds ?? [],
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
