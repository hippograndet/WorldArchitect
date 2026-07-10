import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode, lorekeeperSummarizeNode } from '../nodes.js';
import type { LorekeepMode } from '../../lorekeeper.js';
import type { GroundingCheckOutput } from '../../groundingCheck.js';
import type { ContextDepth, ContextPackage } from '../../../services/archivist.js';
import type { WorldContext } from '../../director.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('lorekeeperSummarize', lorekeeperSummarizeNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'lorekeeperSummarize')
  .addEdge('lorekeeperSummarize', '__end__')
  .compile();

export interface SummarizeGraphOutput {
  introduction: string;
  groundingCheck?: GroundingCheckOutput;
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  tokensIn: number;
  tokensOut: number;
}

export async function runSummarizeGraph(params: {
  worldId: string;
  articleId: string;
  mode?: LorekeepMode;
  contextDepth?: ContextDepth;
  runGroundingCheck?: boolean;
  pipelineRunId?: string;
  worldContext?: WorldContext;
  contextPackage?: ContextPackage;
}): Promise<SummarizeGraphOutput> {
  const result = await graph.invoke({
    worldId: params.worldId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'summarize',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: 'summarize',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'no_commit',
    })),
    lorekeeperMode: params.mode ?? 'full',
    contextDepth: params.contextDepth ?? 'mid',
    runGroundingCheck: params.runGroundingCheck ?? false,
    ...(params.worldContext ? { worldContext: params.worldContext } : {}),
    ...(params.contextPackage ? { contextPackage: params.contextPackage } : {}),
  });
  return {
    introduction: result.introduction!,
    ...(result.groundingCheck ? { groundingCheck: result.groundingCheck } : {}),
    contextPackage: result.contextPackage!,
    worldContext: result.worldContext!,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
