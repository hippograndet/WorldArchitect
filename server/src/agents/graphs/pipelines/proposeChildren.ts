import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode, cartographerNode } from '../nodes.js';
import type { ContextDepth } from '../../../services/archivist.js';
import type { ChildProposalItem } from '../../cartographer.js';
import type { DedupCheckOutput } from '../../dedupCheck.js';
import type { WorldContext } from '../../director.js';

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
  runDedupCheck?: boolean;
  pipelineRunId?: string;
  worldContext?: WorldContext;
}): Promise<{ proposals: ChildProposalItem[]; dedupCheck?: DedupCheckOutput; tokensIn: number; tokensOut: number }> {
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
    runDedupCheck: params.runDedupCheck ?? false,
    ...(params.worldContext ? { worldContext: params.worldContext } : {}),
  });
  return {
    proposals: result.childProposals,
    ...(result.dedupCheck ? { dedupCheck: result.dedupCheck } : {}),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
