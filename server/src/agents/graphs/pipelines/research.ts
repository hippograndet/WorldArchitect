import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode, researcherNode } from '../nodes.js';
import type { ContextDepth, ContextPackage } from '../../../services/archivist.js';
import type { WorldContext } from '../../director.js';
import type { ResearchBrief } from '../../scribe.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('researcher', researcherNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'researcher')
  .addEdge('researcher', '__end__')
  .compile();

export interface ResearchGraphOutput {
  researchBrief: ResearchBrief;
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  tokensIn: number;
  tokensOut: number;
}

export async function runResearchGraph(params: {
  worldId: string;
  ownerId?: string;
  articleId: string;
  contextDepth?: ContextDepth;
  pipelineRunId?: string;
  worldContext?: WorldContext;
}): Promise<ResearchGraphOutput> {
  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'research',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: 'research',
      reviewPolicy: 'auto',
      commitPolicy: 'no_commit',
    })),
    contextDepth: params.contextDepth ?? 'mid',
    ...(params.worldContext ? { worldContext: params.worldContext } : {}),
  });
  return {
    researchBrief: result.researchBrief!,
    contextPackage: result.contextPackage!,
    worldContext: result.worldContext!,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
