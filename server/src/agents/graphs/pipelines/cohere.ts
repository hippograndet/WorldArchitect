import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode } from '../nodes/shared.js';
import { wardenNode } from '../nodes/consolidate/cohere.js';
import type { ContextDepth } from '../../../services/archivist.js';
import type { DraftContextBasis } from '../../../services/draftsService.js';
import type { CoherenceWarning, SuggestedLink } from '../../warden.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('warden', wardenNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'warden')
  .addEdge('warden', '__end__')
  .compile();

export async function runCohereGraph(params: {
  worldId: string;
  ownerId?: string;
  articleId: string;
  contextDepth?: ContextDepth;
  contextBasis?: DraftContextBasis;
  pipelineRunId?: string;
}): Promise<{ warnings: CoherenceWarning[]; suggestedLinks: SuggestedLink[]; tokensIn: number; tokensOut: number }> {
  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'cohere',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: 'cohere',
      reviewPolicy: 'none',
      commitPolicy: 'no_commit',
    })),
    contextDepth: params.contextDepth ?? 'mid',
    contextBasis: params.contextBasis ?? 'current',
  });
  return {
    warnings: result.warnings,
    suggestedLinks: result.suggestedLinks,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
