import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { contractState, worldContract } from '../masContract.js';
import { fetchWorldContextNode, architectNode } from '../nodes.js';
import type { Stub } from '../../architect.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('architect', architectNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'architect')
  .addEdge('architect', '__end__')
  .compile();

export async function runCreateWorldGraph(params: {
  worldId: string;
  ownerId?: string;
  seedText: string;
  categories: Array<{ id: string; name: string }>;
  pipelineRunId?: string;
}): Promise<{ stubs: Stub[]; tokensIn: number; tokensOut: number }> {
  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'create_world',
    ...contractState(worldContract('create_world')),
    seedText: params.seedText,
    categories: params.categories,
  });
  return { stubs: result.stubs, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
