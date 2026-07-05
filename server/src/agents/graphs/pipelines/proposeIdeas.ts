import { StateGraph } from '@langchain/langgraph';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode, oracleNode } from '../nodes.js';
import type { ContextDepth } from '../../../services/archivist.js';
import type { ProposalItem } from '../../muse.js';
import type { IdeaItem } from '../../oracle.js';

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
  articleId: string;
  introduction: string;
  selectedProposal: ProposalItem;
  userSpec?: string;
  contextDepth?: ContextDepth;
}): Promise<{ ideas: IdeaItem[]; tokensIn: number; tokensOut: number }> {
  const result = await graph.invoke({
    worldId: params.worldId,
    articleId: params.articleId,
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
  });
  return { ideas: result.ideas, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
