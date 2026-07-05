import { StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { OrchestrationAnnotation } from '../state.js';
import {
  fetchWorldContextNode,
  buildContextPackageNode,
  researcherNode,
  scribeNode,
  lorekeeperSummarizeAfterExpandNode,
  styleWardenNode,
} from '../nodes.js';
import { articleContract, contractState, expanderIntent } from '../masContract.js';
import type { ContextDepth, ArchivistMode } from '../../../services/archivist.js';
import type { ExpanderMode } from '../../../prompts/expander.js';
import type { ProposalItem } from '../../muse.js';
import type { IdeaItem } from '../../oracle.js';
import type { MentionItem } from '../../scribe.js';
import type { StyleWardenOutput } from '../../styleWarden.js';
import type { ContinuityEditorOutput } from '../../continuityEditor.js';

const graph = new StateGraph(OrchestrationAnnotation)
  .addNode('fetchWorldContext', fetchWorldContextNode)
  .addNode('buildContextPackage', buildContextPackageNode)
  .addNode('researcher', researcherNode)
  .addNode('scribe', scribeNode)
  .addNode('lorekeeperSummarize', lorekeeperSummarizeAfterExpandNode)
  .addNode('styleWarden', styleWardenNode)
  .addEdge('__start__', 'fetchWorldContext')
  .addEdge('fetchWorldContext', 'buildContextPackage')
  .addEdge('buildContextPackage', 'researcher')
  .addEdge('researcher', 'scribe')
  .addEdge('scribe', 'lorekeeperSummarize')
  .addEdge('lorekeeperSummarize', 'styleWarden')
  .addEdge('styleWarden', '__end__')
  .compile();

export interface ExpandGraphOutput {
  description: string;
  introduction?: string;
  parentUpdate?: { appendText: string };
  styleCheck?: StyleWardenOutput;
  continuityCheck?: ContinuityEditorOutput;
  mentions?: MentionItem[];
  tokensIn: number;
  tokensOut: number;
}

export async function runExpandGraph(params: {
  worldId: string;
  articleId: string;
  pipelineType: ExpanderMode;
  selectedProposal: ProposalItem;
  userSpec?: string;
  contextDepth?: ContextDepth;
  selectedIdeas?: IdeaItem[];
  runStyleWarden?: boolean;
  runContinuityEditor?: boolean;
  wordCountPreset?: 'short' | 'medium' | 'long';
  pipelineRunId?: string;
}): Promise<ExpandGraphOutput> {
  const contextMode: ArchivistMode = params.pipelineType === 'reorganize' ? 'reorganize' : 'default';

  const result = await graph.invoke({
    worldId: params.worldId,
    articleId: params.articleId,
    pipelineRunId: params.pipelineRunId ?? nanoid(),
    pipelineType: 'expand',
    ...contractState(articleContract({
      articleId: params.articleId,
      intent: expanderIntent(params.pipelineType),
      reviewPolicy: 'user_must_accept',
      commitPolicy: 'pending_draft',
    })),
    expanderMode: params.pipelineType,
    selectedProposal: params.selectedProposal,
    userSpec: params.userSpec,
    contextDepth: params.contextDepth ?? 'mid',
    contextMode,
    selectedIdeas: params.selectedIdeas,
    runStyleWarden: params.runStyleWarden ?? false,
    runContinuityEditor: params.runContinuityEditor ?? false,
    wordCountPreset: params.wordCountPreset ?? 'medium',
  });

  return {
    description: result.description!,
    ...(result.introduction !== undefined ? { introduction: result.introduction } : {}),
    ...(result.parentUpdate ? { parentUpdate: result.parentUpdate } : {}),
    ...(result.styleCheck ? { styleCheck: result.styleCheck } : {}),
    ...(result.continuityCheck ? { continuityCheck: result.continuityCheck } : {}),
    ...(result.mentions?.length ? { mentions: result.mentions } : {}),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
