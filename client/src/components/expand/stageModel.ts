import type { Run, RunAgentCall, RunConfig, RunReviewItem, RunWithEvents } from '../../types/run.ts';

export type PipelineStartStep = 'inception' | 'expansion' | 'branching';
/** Adds 'research' — the unconditional pre-Inception step every Forge queue item runs through, distinct from PipelineStartStep (which only covers the user-selectable startStep). */
export type AgentStageStep = PipelineStartStep | 'research';
export type AgentStageStatus = 'completed' | 'failed' | 'running' | 'pending' | 'skipped';

export interface AgentStage {
  key: string;
  step: AgentStageStep;
  group: string;
  agentType: string;
  label: string;
  status: AgentStageStatus;
  call?: RunAgentCall;
  detail?: string;
}

export const AGENT_LABELS: Record<string, string> = {
  context_assembly: 'Context Assembly',
  lorekeeper: 'Lorekeeper',
  grounding_check: 'Grounding Check',
  muse: 'Muse',
  curator: 'Curator',
  researcher: 'Researcher',
  scribe: 'Scribe',
  continuity_editor: 'Continuity Editor',
  cartographer: 'Cartographer',
  dedup_check: 'Dedup Check',
};

export const AGENT_TASKS: Record<string, string> = {
  context_assembly: 'Context',
  lorekeeper: 'Intro',
  grounding_check: 'Grounding',
  muse: 'Direction',
  curator: 'Select',
  researcher: 'Research',
  scribe: 'Draft',
  continuity_editor: 'Continuity',
  cartographer: 'Children',
  dedup_check: 'Dedup',
};

export function isRunActive(run: Run | RunWithEvents): boolean {
  return run.status === 'running' || run.status === 'pending' || run.status === 'needs_input';
}

export function isRunSavedHistory(run: Run | RunWithEvents): boolean {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'stopped';
}

export function runDurationMs(run: Run | RunWithEvents): number {
  const end = isRunActive(run) ? Date.now() : run.updatedAt;
  return Math.max(0, end - run.createdAt);
}

export function startStepFromPipelineType(pipelineType: RunConfig['pipelineType']): PipelineStartStep {
  if (pipelineType === 'propose_children') return 'branching';
  if (pipelineType === 'forge_expand' || pipelineType === 'expand_description') return 'expansion';
  return 'inception';
}

export function runStartStep(run: RunWithEvents): PipelineStartStep {
  if (run.config.startStep) return run.config.startStep;
  if (run.config.pipelineType) return startStepFromPipelineType(run.config.pipelineType);
  const oldestEvent = [...run.events].reverse()[0];
  if (oldestEvent?.step === 'Expansion') return 'expansion';
  if (oldestEvent?.step === 'Branching') return 'branching';
  return 'inception';
}

export function runPipelineSteps(run: RunWithEvents): AgentStageStep[] {
  const order: PipelineStartStep[] = ['inception', 'expansion', 'branching'];
  const start = runStartStep(run);
  const continuation = run.config.forgeContinuationMode ?? 'finish_document';
  const rest = continuation === 'one_step' ? [start] : order.slice(order.indexOf(start));
  // 'research' always runs first, unconditionally, for every queue item —
  // even when startStep/continuation mode skip straight past Inception —
  // so it's prepended here regardless of `start`/`continuation`.
  return ['research', ...rest];
}

function agentStageDefinitions(run: RunWithEvents): Array<Omit<AgentStage, 'status' | 'call' | 'detail'>> {
  const stages: Array<Omit<AgentStage, 'status' | 'call' | 'detail'>> = [];
  const add = (step: AgentStageStep, group: string, agentType: string) => {
    stages.push({
      key: `${step}:${group}:${agentType}:${stages.length}`,
      step,
      group,
      agentType,
      label: AGENT_LABELS[agentType] ?? agentType,
    });
  };

  for (const step of runPipelineSteps(run)) {
    if (step === 'research') {
      // Researcher now runs once per queue item, before Inception/Expansion/
      // Branching — and builds the ContextPackage the rest of the cascade
      // reuses, so the "Context Assembly" pseudo-stage lives here instead of
      // being repeated under Inception/Expansion.
      add(step, 'Context', 'context_assembly');
      add(step, 'Research', 'researcher');
    }
    const coherenceCheckOn = (run.config.coherenceCheckLevel ?? 0) > 0;
    if (step === 'inception') {
      add(step, 'Introduction', 'lorekeeper');
      if (coherenceCheckOn) add(step, 'Grounding', 'grounding_check');
    }
    if (step === 'expansion') {
      add(step, 'Direction', 'muse');
      add(step, 'Direction', 'curator');
      add(step, 'Drafting', 'scribe');
      if (coherenceCheckOn) add(step, 'Continuity', 'continuity_editor');
    }
    if (step === 'branching') {
      // Branching intentionally always rebuilds its own ContextPackage under
      // 'propose_children' mode rather than reusing Research's — see
      // runProposeChildrenGraph's comment in pipelines/proposeChildren.ts.
      add(step, 'Context', 'context_assembly');
      add(step, 'Children', 'cartographer');
      if (coherenceCheckOn) add(step, 'Children', 'dedup_check');
    }
  }

  return stages;
}

export function pipelineStepForCall(call: RunAgentCall): AgentStageStep | null {
  if (call.pipelineType === 'research') return 'research';
  if (call.pipelineType === 'summarize') return 'inception';
  if (call.pipelineType === 'propose' || call.pipelineType === 'expand') return 'expansion';
  if (call.pipelineType === 'propose_children') return 'branching';
  return null;
}

export function buildAgentStages(run: RunWithEvents, articleId: string | null): AgentStage[] {
  const callsByAgent = new Map<string, RunAgentCall[]>();
  const rootArticleId = run.config.rootArticleId ?? run.articleIds[0] ?? null;
  const articleCalls = (run.agentCalls ?? []).filter((call) => (
    articleId
      ? call.articleId === articleId || (call.articleId === null && articleId === rootArticleId)
      : true
  ));
  const articleReviews = (run.reviewItems ?? []).filter((review) => (
    articleId
      ? review.articleId === articleId || (review.articleId === null && articleId === rootArticleId)
      : true
  ));
  for (const call of articleCalls) {
    if (!callsByAgent.has(call.agentType)) callsByAgent.set(call.agentType, []);
    callsByAgent.get(call.agentType)!.push(call);
  }
  const calledSteps = new Set(articleCalls.map(pipelineStepForCall).filter(Boolean));
  const latestReviewByKind = new Map<string, RunReviewItem>();
  for (const review of articleReviews) {
    latestReviewByKind.set(review.kind, review);
  }

  const stages = agentStageDefinitions(run).map<AgentStage>((stage) => {
    if (stage.agentType === 'context_assembly') {
      return {
        ...stage,
        status: calledSteps.has(stage.step) ? 'completed' : 'pending',
        detail: calledSteps.has(stage.step) ? 'Context package prepared.' : undefined,
      };
    }
    const calls = callsByAgent.get(stage.agentType) ?? [];
    const failedCall = calls.find((call) => call.status === 'error' || call.status === 'rejected');
    const latestCall = calls[calls.length - 1];
    if (failedCall) {
      return {
        ...stage,
        status: 'failed',
        call: failedCall,
        detail: failedCall.errorMessage ?? `${stage.label} failed.`,
      };
    }
    if (latestCall?.status === 'success') {
      return {
        ...stage,
        status: 'completed',
        call: latestCall,
        detail: `${stage.label} completed.`,
      };
    }
    if (stage.agentType === 'curator') {
      const review = latestReviewByKind.get('idea_selection');
      if (review?.status === 'accepted') {
        return {
          ...stage,
          status: 'completed',
          detail: 'Themes selected by user.',
        };
      }
      if (review?.status === 'rejected') {
        return {
          ...stage,
          status: 'failed',
          detail: 'Themes rejected by user.',
        };
      }
    }
    return {
      ...stage,
      status: 'pending',
    };
  });

  let hasFailure = stages.some((stage) => stage.status === 'failed');
  const failedStep = run.events.find((event) => !event.ok)?.step.toLowerCase() as AgentStageStep | undefined;
  if (!hasFailure && failedStep) {
    const failedStage = stages.find((stage) => stage.step === failedStep && stage.status === 'pending');
    if (failedStage) {
      failedStage.status = 'failed';
      failedStage.detail = `${failedStage.label} did not complete before ${failedStage.step}.`;
      hasFailure = true;
    }
  }
  if (isRunActive(run) && !hasFailure) {
    const next = stages.find((stage) => stage.status === 'pending');
    if (next) next.status = 'running';
  }
  return stages;
}

export function stageStatusClass(status: AgentStageStatus): string {
  if (status === 'completed') return 'bg-green-100 text-green-700';
  if (status === 'failed') return 'bg-red-100 text-red-700';
  if (status === 'running') return 'bg-blue-100 text-blue-700';
  if (status === 'skipped') return 'bg-gray-100 text-gray-500';
  return 'bg-gray-100 text-gray-500';
}

export function stageStatusLabel(status: AgentStageStatus): string {
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'running') return 'Running';
  if (status === 'skipped') return 'Skipped';
  return 'To come';
}

export function stageStatusDotClass(status: AgentStageStatus): string {
  if (status === 'completed') return 'bg-green-500';
  if (status === 'failed') return 'bg-red-500';
  if (status === 'running') return 'bg-amber-400';
  if (status === 'skipped') return 'bg-gray-300';
  return 'bg-gray-300';
}

export function stageTaskLabel(stage: AgentStage): string {
  return AGENT_TASKS[stage.agentType] ?? stage.group;
}

export function stageStatusSentence(stage: AgentStage): string {
  if (stage.status === 'running') return `${stage.label} is working on ${stageTaskLabel(stage).toLowerCase()}.`;
  if (stage.status === 'pending') return `${stage.label} is queued for ${stageTaskLabel(stage).toLowerCase()}.`;
  if (stage.status === 'failed') return stage.detail ?? `${stage.label} found an issue.`;
  if (stage.status === 'completed') {
    if (stage.agentType === 'context_assembly') return 'Context is ready for this article.';
    return stage.detail ?? `${stage.label} completed ${stageTaskLabel(stage).toLowerCase()}.`;
  }
  return `${stage.label} was skipped.`;
}

export function stageDiagnosticNote(stage: AgentStage): string {
  return stage.detail
    ?? stage.call?.errorMessage
    ?? (stage.agentType === 'context_assembly'
      ? 'The system assembled world and article context before the LLM agent stage.'
      : stage.status === 'pending'
        ? 'This stage has not run for the selected article yet.'
        : stage.status === 'running'
          ? 'This is the next expected MAS stage for the selected article.'
          : 'No additional details were recorded for this stage.');
}
