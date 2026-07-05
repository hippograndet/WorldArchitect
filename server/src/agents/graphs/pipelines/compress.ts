import { StateGraph } from '@langchain/langgraph';
import { OrchestrationAnnotation } from '../state.js';
import { contractState, worldContract } from '../masContract.js';
import { fetchWorldContextNode, loadBibleEntriesNode, condenserNode } from '../nodes.js';
import type { CompressionEntry } from '../../condenser.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('loadBibleEntries', loadBibleEntriesNode)
  .addNode('condenser', condenserNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'loadBibleEntries')
  .addEdge('loadBibleEntries', 'condenser')
  .addEdge('condenser', '__end__')
  .compile();

export async function runCompressGraph(params: {
  worldId: string;
}): Promise<{ entries: CompressionEntry[]; tokensIn: number; tokensOut: number }> {
  const result = await graph.invoke({ worldId: params.worldId, ...contractState(worldContract('compress')) });
  return { entries: result.compressedEntries, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
