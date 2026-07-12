import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { fetchWorldContextNode, buildContextPackageNode, museProposeNode, curatorAutoSelectNode } from '../nodes.js';
import { articleContract, contractState, proposalIntent } from '../masContract.js';
import type { ContextDepth, ContextPackage } from '../../../services/archivist.js';
import type { ProposalMode } from '../../../prompts/proposal.js';
import type { IdeaItem } from '../../muse.js';
import type { WorldContext } from '../../director.js';
import type { ResearchBrief } from '../../scribe.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('musePropose', museProposeNode)
  .addNode('curatorAutoSelect', curatorAutoSelectNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'musePropose')
  .addEdge('musePropose', 'curatorAutoSelect')
  .addEdge('curatorAutoSelect', '__end__')
  .compile();

export interface ProposeGraphOutput {
  ideas: IdeaItem[];
  autoSelectedIndices?: number[];
  autoSelectRationale?: string;
  tokensIn: number;
  tokensOut: number;
}

export async function runProposeGraph(params: {
  worldId: string;
  ownerId?: string;
  articleId: string;
  pipelineType: ProposalMode;
  userSpec?: string;
  autoSelect?: boolean;
  contextDepth?: ContextDepth;
  pipelineRunId?: string;
  worldContext?: WorldContext;
  contextPackage?: ContextPackage;
  researchBrief?: ResearchBrief;
}): Promise<ProposeGraphOutput> {
  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'propose',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: proposalIntent(params.pipelineType),
      reviewPolicy: params.autoSelect ? 'auto' : 'user_must_select',
      commitPolicy: 'no_commit',
    })),
    proposalMode: params.pipelineType,
    userSpec: params.userSpec,
    autoSelect: params.autoSelect ?? false,
    contextDepth: params.contextDepth ?? 'mid',
    ...(params.worldContext ? { worldContext: params.worldContext } : {}),
    ...(params.contextPackage ? { contextPackage: params.contextPackage } : {}),
    ...(params.researchBrief ? { researchBrief: params.researchBrief } : {}),
  });

  return {
    ideas: result.ideas,
    autoSelectedIndices: result.autoSelectedIndices,
    autoSelectRationale: result.autoSelectRationale,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
