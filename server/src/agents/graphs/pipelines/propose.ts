import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { fetchWorldContextNode, buildContextPackageNode, museProposeNode, curatorAutoSelectNode } from '../nodes.js';
import { articleContract, contractState, proposalIntent } from '../masContract.js';
import type { ContextDepth, ContextPackage } from '../../../services/archivist.js';
import type { ProposalMode } from '../../../prompts/proposal.js';
import type { ProposalItem } from '../../muse.js';
import type { WorldContext } from '../../director.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('musePropose', museProposeNode)
  .addNode('curatorAutoSelect', curatorAutoSelectNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'musePropose')
  .addEdge('musePropose', 'curatorAutoSelect')
  .addEdge('curatorAutoSelect', '__end__')
  .compile();

export interface ProposeGraphOutput {
  proposals: ProposalItem[];
  autoSelectedIndex?: number;
  autoSelectRationale?: string;
  tokensIn: number;
  tokensOut: number;
}

export async function runProposeGraph(params: {
  worldId: string;
  articleId: string;
  pipelineType: ProposalMode;
  userSpec?: string;
  autoSelect?: boolean;
  contextDepth?: ContextDepth;
  pipelineRunId?: string;
  worldContext?: WorldContext;
  contextPackage?: ContextPackage;
}): Promise<ProposeGraphOutput> {
  const result = await graph.invoke({
    worldId: params.worldId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'propose',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: proposalIntent(params.pipelineType),
      reviewPolicy: params.autoSelect ? 'auto' : 'user_must_select',
      commitPolicy: 'no_commit',
    })),
    proposalMode: params.pipelineType,
    userSpec: params.userSpec,
    autoSelect: params.autoSelect ?? false,
    contextDepth: params.contextDepth ?? 'mid',
    ...(params.worldContext ? { worldContext: params.worldContext } : {}),
    ...(params.contextPackage ? { contextPackage: params.contextPackage } : {}),
  });

  return {
    proposals: result.proposals,
    autoSelectedIndex: result.autoSelectedIndex,
    autoSelectRationale: result.autoSelectRationale,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
