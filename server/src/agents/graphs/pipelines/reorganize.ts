import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode } from '../nodes/shared.js';
import { scribeNode } from '../nodes/forge/draft.js';
import { sentinelNode, lorekeeperSummarizeUnconditionalNode } from '../nodes/consolidate/reorganize.js';
import type { ContextDepth } from '../../../services/archivist.js';
import type { DraftContextBasis } from '../../../services/draftsService.js';
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
  contextDraftIds: string[];
  tokensIn: number;
  tokensOut: number;
}

export async function runReorganizeGraph(params: {
  worldId: string;
  ownerId?: string;
  articleId: string;
  contextDepth?: ContextDepth;
  contextBasis?: DraftContextBasis;
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
    contextBasis: params.contextBasis ?? 'current',
    contextMode: 'reorganize',
    expanderMode: 'reorganize',
  });

  return {
    description: result.description!,
    introduction: result.introduction!,
    retentionIssues: result.retentionIssues,
    contextDraftIds: result.contextPackage?.contextDraftIds ?? [],
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
