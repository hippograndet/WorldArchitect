import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { contractState, worldContract } from '../masContract.js';
import { fetchWorldContextNode, loadAuditSummariesNode, auditorNode } from '../nodes.js';
import type { EdgeProposal, GlobalWarning } from '../../auditor.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('loadAuditSummaries', loadAuditSummariesNode)
  .addNode('auditor', auditorNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'loadAuditSummaries')
  .addEdge('loadAuditSummaries', 'auditor')
  .addEdge('auditor', '__end__')
  .compile();

export async function runAuditGraph(params: {
  worldId: string;
  ownerId?: string;
  sampleSize?: number;
  focus?: 'all' | 'recent';
  pipelineRunId?: string;
}): Promise<{ edgeProposals: EdgeProposal[]; globalWarnings: GlobalWarning[]; tokensIn: number; tokensOut: number }> {
  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'audit',
    ...contractState(worldContract('audit')),
    sampleSize: params.sampleSize,
    focus: params.focus ?? 'all',
  });
  return {
    edgeProposals: result.edgeProposals,
    globalWarnings: result.globalWarnings,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
