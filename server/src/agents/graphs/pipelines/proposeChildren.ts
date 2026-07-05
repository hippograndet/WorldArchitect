import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode, cartographerNode } from '../nodes.js';
import type { ContextDepth } from '../../../services/archivist.js';
import type { ChildProposalItem } from '../../cartographer.js';

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
  articleId: string;
  userSpec?: string;
  contextDepth?: ContextDepth;
  pipelineRunId?: string;
}): Promise<{ proposals: ChildProposalItem[]; tokensIn: number; tokensOut: number }> {
  const result = await graph.invoke({
    worldId: params.worldId,
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
    contextMode: 'propose_children',
  });
  return { proposals: result.childProposals, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
