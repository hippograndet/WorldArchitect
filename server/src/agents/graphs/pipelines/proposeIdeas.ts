import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode, oracleNode } from '../nodes.js';
import type { ContextDepth, ContextPackage } from '../../../services/archivist.js';
import type { ProposalItem } from '../../muse.js';
import type { IdeaItem } from '../../oracle.js';
import type { WorldContext } from '../../director.js';
import type { ResearchBrief } from '../../scribe.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('oracle', oracleNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'oracle')
  .addEdge('oracle', '__end__')
  .compile();

export async function runProposeIdeasGraph(params: {
  worldId: string;
  ownerId?: string;
  articleId: string;
  introduction: string;
  selectedProposal: ProposalItem;
  userSpec?: string;
  contextDepth?: ContextDepth;
  pipelineRunId?: string;
  worldContext?: WorldContext;
  contextPackage?: ContextPackage;
  researchBrief?: ResearchBrief;
}): Promise<{ ideas: IdeaItem[]; tokensIn: number; tokensOut: number }> {
  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'propose_ideas',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: 'ideate',
      reviewPolicy: 'user_must_select',
      commitPolicy: 'no_commit',
    })),
    introduction: params.introduction,
    selectedProposal: params.selectedProposal,
    userSpec: params.userSpec,
    contextDepth: params.contextDepth ?? 'mid',
    ...(params.worldContext ? { worldContext: params.worldContext } : {}),
    ...(params.contextPackage ? { contextPackage: params.contextPackage } : {}),
    ...(params.researchBrief ? { researchBrief: params.researchBrief } : {}),
  });
  return { ideas: result.ideas, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
