import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode } from '../nodes/shared.js';
import { scribeNode } from '../nodes/expand/draft.js';
import { sentinelNode, lorekeeperSummarizeUnconditionalNode } from '../nodes/consolidate/reorganize.js';
import type { ContextDepth } from '../../../services/archivist.js';
import type { RetentionIssue } from '../../sentinel.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('scribe', scribeNode)
  .addNode('sentinel', sentinelNode)
  .addNode('lorekeeperSummarize', lorekeeperSummarizeUnconditionalNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'scribe')
  .addEdge('scribe', 'sentinel')
  .addEdge('sentinel', 'lorekeeperSummarize')
  .addEdge('lorekeeperSummarize', '__end__')
  .compile();

export interface ReorganizeGraphOutput {
  description: string;
  introduction: string;
  retentionIssues: RetentionIssue[];
  tokensIn: number;
  tokensOut: number;
}

export async function runReorganizeGraph(params: {
  worldId: string;
  ownerId?: string;
  articleId: string;
  contextDepth?: ContextDepth;
  pipelineRunId?: string;
}): Promise<ReorganizeGraphOutput> {
  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'reorganize',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: 'reorganize',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
    })),
    contextDepth: params.contextDepth ?? 'mid',
    contextMode: 'reorganize',
    expanderMode: 'reorganize',
  });

  return {
    description: result.description!,
    introduction: result.introduction!,
    retentionIssues: result.retentionIssues,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
