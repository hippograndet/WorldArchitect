import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode, chroniclerNode, wardenNode, styleWardenNode } from '../nodes.js';
import type { ContextDepth } from '../../../services/archivist.js';
import type { CoherenceWarning, SuggestedLink } from '../../warden.js';
import type { StyleWardenOutput } from '../../styleWarden.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('chronicler', chroniclerNode)
  .addNode('warden', wardenNode)
  .addNode('styleWarden', styleWardenNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'chronicler')
  .addEdge('chronicler', 'warden')
  .addEdge('warden', 'styleWarden')
  .addEdge('styleWarden', '__end__')
  .compile();

export interface ChronologyGraphOutput {
  chronologySection: string;
  coherenceWarnings: CoherenceWarning[];
  suggestedLinks: SuggestedLink[];
  styleCheck?: StyleWardenOutput;
  tokensIn: number;
  tokensOut: number;
}

export async function runChronologyGraph(params: {
  worldId: string;
  articleId: string;
  userSpec?: string;
  contextDepth?: ContextDepth;
  runStyleWarden?: boolean;
  pipelineRunId?: string;
}): Promise<ChronologyGraphOutput> {
  const result = await graph.invoke({
    worldId: params.worldId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'chronology',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: 'chronology',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
    })),
    userSpec: params.userSpec,
    contextDepth: params.contextDepth ?? 'mid',
    contextMode: 'expand_chronology',
    runStyleWarden: params.runStyleWarden ?? false,
  });

  return {
    chronologySection: result.chronologySection!,
    coherenceWarnings: result.warnings,
    suggestedLinks: result.suggestedLinks,
    ...(result.styleCheck ? { styleCheck: result.styleCheck } : {}),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
