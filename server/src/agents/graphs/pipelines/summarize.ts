import { StateGraph } from '@langchain/langgraph';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, lorekeeperSummarizeNode } from '../nodes.js';
import type { LorekeepMode } from '../../lorekeeper.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('lorekeeperSummarize', lorekeeperSummarizeNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'lorekeeperSummarize')
  .addEdge('lorekeeperSummarize', '__end__')
  .compile();

export async function runSummarizeGraph(params: {
  worldId: string;
  articleId: string;
  mode?: LorekeepMode;
}): Promise<{ introduction: string; tokensIn: number; tokensOut: number }> {
  const result = await graph.invoke({
    worldId: params.worldId,
    articleId: params.articleId,
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: 'summarize',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'no_commit',
    })),
    lorekeeperMode: params.mode ?? 'full',
  });
  return { introduction: result.introduction!, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
