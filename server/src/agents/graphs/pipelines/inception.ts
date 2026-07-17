import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import { articleContract, contractState } from '../masContract.js';
import { fetchWorldContextNode, buildContextPackageNode } from '../nodes/shared.js';
import { heraldWriteIntroNode } from '../nodes/forge/inception.js';
import type { HeraldMode } from '../../herald.js';
import type { ContextDepth, ContextPackage, WorldInfoContext } from '../../../services/archivist.js';
import type { WorldContext } from '../../director.js';
import type { ResearchBrief } from '../../scribe.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('heraldWriteIntro', heraldWriteIntroNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'heraldWriteIntro')
  .addEdge('heraldWriteIntro', '__end__')
  .compile();

export interface InceptionGraphOutput {
  introduction: string;
  contextPackage: ContextPackage;
  worldContext: WorldContext;
  worldInfoContext: WorldInfoContext;
  tokensIn: number;
  tokensOut: number;
}

export async function runInceptionGraph(params: {
  worldId: string;
  ownerId?: string;
  articleId: string;
  mode?: HeraldMode;
  contextDepth?: ContextDepth;
  coherenceCheckLevel?: number;
  safetyNet?: boolean;
  userSpec?: string;
  pipelineRunId?: string;
  worldContext?: WorldContext;
  worldInfoContext?: WorldInfoContext;
  contextPackage?: ContextPackage;
  researchBrief?: ResearchBrief;
}): Promise<InceptionGraphOutput> {
  const result = await graph.invoke({
    worldId: params.worldId,
    ownerId: params.ownerId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    // 'summarize' is the persisted call_log.pipeline_type value — unrelated
    // to the Herald agent rename, kept as-is (same reasoning as DB-persisted
    // agentType strings; see dev-docs/reference/mas-overview.md's aliases table).
    pipelineType: 'summarize',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: 'summarize',
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'no_commit',
    })),
    heraldMode: params.mode ?? 'full',
    contextDepth: params.contextDepth ?? 'mid',
    coherenceCheckLevel: params.coherenceCheckLevel ?? 0,
    safetyNet: params.safetyNet ?? false,
    userSpec: params.userSpec,
    ...(params.worldContext ? { worldContext: params.worldContext } : {}),
    ...(params.worldInfoContext ? { worldInfoContext: params.worldInfoContext } : {}),
    ...(params.contextPackage ? { contextPackage: params.contextPackage } : {}),
    ...(params.researchBrief ? { researchBrief: params.researchBrief } : {}),
  });
  return {
    introduction: result.introduction!,
    contextPackage: result.contextPackage!,
    worldContext: result.worldContext!,
    worldInfoContext: result.worldInfoContext!,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
