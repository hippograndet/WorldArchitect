import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode } from '../nodes/shared.js';
import { cartographerNode } from '../nodes/expand/branching.js';
import type { ContextDepth, WorldInfoContext } from '../../../services/archivist.js';
import type { DraftContextBasis } from '../../../services/draftsService.js';
import type { ChildProposalItem } from '../../cartographer.js';
import type { GatekeeperOutput } from '../../gatekeeper.js';
import type { WorldContext } from '../../director.js';
import type { ResearchBrief } from '../../scribe.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('cartographer', cartographerNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'cartographer')
  .addEdge('cartographer', '__end__')
  .compile();

export async function runProposeChildrenGraph(params: {
  worldId: string;
  ownerId?: string;
  articleId: string;
  userSpec?: string;
  contextDepth?: ContextDepth;
  contextBasis?: DraftContextBasis;
  coherenceCheckLevel?: number;
  safetyNet?: boolean;
  pipelineRunId?: string;
  worldContext?: WorldContext;
  worldInfoContext?: WorldInfoContext;
  researchBrief?: ResearchBrief;
  // Deliberately no contextPackage? param — Branching always rebuilds its own
  // package under 'propose_children' mode (a different tier composition than
  // Inception/Expansion's 'default' mode), and should see live DB state after
  // Expansion may have just written a description. Do not thread a cached
  // 'default'-mode package in here.
}): Promise<{ proposals: ChildProposalItem[]; gatekeeperCheck?: GatekeeperOutput; tokensIn: number; tokensOut: number }> {
  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'propose_children',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: 'branch',
      reviewPolicy: 'user_must_select',
      commitPolicy: 'no_commit',
    })),
    userSpec: params.userSpec,
    contextDepth: params.contextDepth ?? 'mid',
    contextBasis: params.contextBasis ?? 'current',
    contextMode: 'propose_children',
    coherenceCheckLevel: params.coherenceCheckLevel ?? 0,
    safetyNet: params.safetyNet ?? false,
    ...(params.worldContext ? { worldContext: params.worldContext } : {}),
    ...(params.worldInfoContext ? { worldInfoContext: params.worldInfoContext } : {}),
    ...(params.researchBrief ? { researchBrief: params.researchBrief } : {}),
  });
  return {
    proposals: result.childProposals,
    ...(result.gatekeeperCheck ? { gatekeeperCheck: result.gatekeeperCheck } : {}),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
