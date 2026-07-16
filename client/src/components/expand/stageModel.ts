import type { Run, RunAgentCall, RunConfig, RunQueueItem, RunReviewItem, RunWithEvents } from '../../types/run.ts';

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
  /** Set on checker stages (continuity_editor/dedup_check): the generator agent it can send back to for revision. */
  retryGeneratorAgentType?: string;
  /** Max check→revise cycles configured for this run (run.config.coherenceCheckLevel). */
  retryMax?: number;
  /** How many times the generator was actually re-invoked this run. */
  retryActual?: number;
}

// Keys are the DB-persisted agentType strings (unchanged since the Herald/
// Arbiter/Gatekeeper/Stylizer rename — see dev-docs/reference/mas-overview.md's
// aliases table); only the display labels reflect the new agent names.
export const AGENT_LABELS: Record<string, string> = {
  lorekeeper: 'Herald',
  muse: 'Muse',
  curator: 'Curator',
  researcher: 'Researcher',
  scribe: 'Scribe',
  continuity_editor: 'Arbiter',
  style_warden: 'Stylizer',
  cartographer: 'Cartographer',
  dedup_check: 'Gatekeeper',
};

export const AGENT_TASKS: Record<string, string> = {
  lorekeeper: 'Intro',
  muse: 'Direction',
  curator: 'Select',
  researcher: 'Research',
  scribe: 'Draft',
  continuity_editor: 'Continuity',
  style_warden: 'Style',
  cartographer: 'Children',
  dedup_check: 'Dedup',
};

/** Checker agent → the generator agent it reviews and can send back for revision (see server's runCheckReviseLoop). */
export const CHECKER_GENERATOR_PAIRS: Record<string, string> = {
  continuity_editor: 'scribe',
  dedup_check: 'cartographer',
};

export function isRunActive(run: Run | RunWithEvents): boolean {
  return run.status === 'running' || run.status === 'pending' || run.status === 'needs_input';
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

const STEP_ORDER: PipelineStartStep[] = ['inception', 'expansion', 'branching'];

/** The subset of a RunQueueItem's fields needed to know which steps apply to it. */
export type StagePlanItem = Pick<RunQueueItem, 'depth' | 'startStep'>;

/**
 * Whether `step` is actually attempted for this item, derived from the same
 * rules forgeGraph/routing.ts's routeAfterInception/routeAfterExpansion/
 * routeAfterBranching and branchingNode's depth guard (forgeGraph/nodes.ts)
 * apply server-side — so this must be kept in sync with those, not with
 * runPipelineSteps' old (root-only) approximation.
 */
export function itemAppliesStep(item: StagePlanItem, step: PipelineStartStep, run: RunWithEvents): boolean {
  const startIdx = STEP_ORDER.indexOf(item.startStep);
  const stepIdx = STEP_ORDER.indexOf(step);
  if (stepIdx < startIdx) return false;
  const continuation = run.config.forgeContinuationMode ?? 'finish_document';
  if (continuation === 'one_step' && stepIdx > startIdx) return false;
  if (step === 'branching' && item.depth >= (run.config.forgeMaxDepth ?? 2)) return false;
  return true;
}

function agentStageDefinitions(
  run: RunWithEvents,
  item: StagePlanItem,
): Array<Omit<AgentStage, 'status' | 'call' | 'detail'> & { plannedOut: boolean }> {
  const stages: Array<Omit<AgentStage, 'status' | 'call' | 'detail'> & { plannedOut: boolean }> = [];
  const add = (step: AgentStageStep, group: string, agentType: string, plannedOut: boolean) => {
    stages.push({
      key: `${step}:${group}:${agentType}:${stages.length}`,
      step,
      group,
      agentType,
      label: AGENT_LABELS[agentType] ?? agentType,
      plannedOut,
    });
  };

  // 'research' always runs first, unconditionally, for every queue item —
  // even when startStep/continuation mode skip straight past Inception —
  // so it's never itself skippable. Context assembly isn't a distinct
  // agent — if it fails, that failure surfaces on Researcher (see the
  // failedSteps handling in buildAgentStages below).
  add('research', 'Research', 'researcher', false);

  const coherenceCheckOn = (run.config.coherenceCheckLevel ?? 0) > 0;

  add('inception', 'Introduction', 'lorekeeper', !itemAppliesStep(item, 'inception', run));

  const expansionOut = !itemAppliesStep(item, 'expansion', run);
  add('expansion', 'Direction', 'muse', expansionOut);
  add('expansion', 'Direction', 'curator', expansionOut);
  add('expansion', 'Drafting', 'scribe', expansionOut);
  if (coherenceCheckOn) add('expansion', 'Continuity', 'continuity_editor', expansionOut);
  // Stylizer runs after Scribe/Arbiter, gated behind its own runStylizer
  // toggle (independent of coherenceCheckLevel) — see pipelines/expand.ts's
  // scribe -> stylizer edge.
  if (run.config.runStylizer) add('expansion', 'Style', 'style_warden', expansionOut);

  // Branching intentionally always rebuilds its own ContextPackage under
  // 'propose_children' mode rather than reusing Research's — see
  // runProposeChildrenGraph's comment in pipelines/proposeChildren.ts. Same
  // reasoning as Research: no separate stage, failures surface on Cartographer.
  const branchingOut = !itemAppliesStep(item, 'branching', run);
  add('branching', 'Children', 'cartographer', branchingOut);
  if (coherenceCheckOn) add('branching', 'Children', 'dedup_check', branchingOut);

  return stages;
}

/**
 * A generic, run-agnostic rendering of the full pipeline (every step, every
 * agent, coherence checking and Stylizer both "on") for the standalone
 * "View Pipeline" reference diagram — not tied to any real run's data, so
 * every stage renders 'pending' and retry counters show 0 of an illustrative max.
 */
export function buildStandardPipelineStages(): AgentStage[] {
  const genericRun = {
    config: {
      startStep: 'inception',
      forgeContinuationMode: 'recursive',
      coherenceCheckLevel: 1,
      runStylizer: true,
      forgeMaxDepth: 2,
    },
  } as RunWithEvents;
  const item: StagePlanItem = { depth: 0, startStep: 'inception' };
  return agentStageDefinitions(genericRun, item).map(({ plannedOut: _plannedOut, ...stage }) => {
    const generatorAgentType = CHECKER_GENERATOR_PAIRS[stage.agentType];
    return {
      ...stage,
      status: 'pending',
      ...(generatorAgentType ? { retryGeneratorAgentType: generatorAgentType, retryMax: 1, retryActual: 0 } : {}),
    };
  });
}

export function buildAgentStages(run: RunWithEvents, articleId: string | null): AgentStage[] {
  const callsByAgent = new Map<string, RunAgentCall[]>();
  const rootArticleId = run.config.rootArticleId ?? run.articleIds[0] ?? null;
  const item: StagePlanItem = (run.queueItems ?? []).find((qi) => qi.articleId === articleId)
    ?? { depth: 0, startStep: runStartStep(run) };
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
  const latestReviewByKind = new Map<string, RunReviewItem>();
  for (const review of articleReviews) {
    latestReviewByKind.set(review.kind, review);
  }

  // A checker (continuity_editor/dedup_check) can send its
  // generator back for revision up to run.config.coherenceCheckLevel times;
  // the generator agentType is step-specific (e.g. lorekeeper only appears in
  // Inception), so counting its calls here is unambiguous. The first call is
  // the initial draft, not a retry.
  const retryInfoForChecker = (checkerAgentType: string): Pick<AgentStage, 'retryGeneratorAgentType' | 'retryMax' | 'retryActual'> | undefined => {
    const generatorAgentType = CHECKER_GENERATOR_PAIRS[checkerAgentType];
    if (!generatorAgentType) return undefined;
    const generatorCalls = callsByAgent.get(generatorAgentType) ?? [];
    return {
      retryGeneratorAgentType: generatorAgentType,
      retryMax: run.config.coherenceCheckLevel ?? 0,
      retryActual: Math.max(0, generatorCalls.length - 1),
    };
  };

  const stages = agentStageDefinitions(run, item).map<AgentStage>((stageDef) => {
    const { plannedOut, ...stage } = stageDef;
    if (plannedOut) {
      return {
        ...stage,
        status: 'skipped',
        detail: `${stage.label} is switched off for this run's settings.`,
      };
    }
    const retryInfo = retryInfoForChecker(stage.agentType);
    const calls = callsByAgent.get(stage.agentType) ?? [];
    const failedCall = calls.find((call) => call.status === 'error' || call.status === 'rejected');
    const latestCall = calls[calls.length - 1];
    if (failedCall) {
      return {
        ...stage,
        ...retryInfo,
        status: 'failed',
        call: failedCall,
        detail: failedCall.errorMessage ?? `${stage.label} failed.`,
      };
    }
    if (latestCall?.status === 'success') {
      return {
        ...stage,
        ...retryInfo,
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
      ...retryInfo,
      status: 'pending',
    };
  });

  let hasFailure = stages.some((stage) => stage.status === 'failed');
  // Mark every step that has a failed event, not just the most recent one —
  // an early non-fatal failure (e.g. Research) can be followed by a second,
  // consequential failure in a later step; both should show as failed rather
  // than only the latest, which would otherwise look like the earlier step
  // never ran at all.
  const failedSteps = new Set(
    run.events.filter((event) => !event.ok).map((event) => event.step.toLowerCase() as AgentStageStep),
  );
  for (const failedStep of failedSteps) {
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

export interface CountProgress {
  completed: number;
  total: number;
}

/**
 * Run-wide Inception/Expansion/Branching completed/total, summed across
 * every known queue item (not just the currently selected article) — the
 * root plus every child branching has revealed so far. Grows over the run's
 * lifetime exactly like `run.itemsTotal` already does as new children are
 * discovered, settling on a final total once the queue drains. Steps a given
 * item never attempts (see `itemAppliesStep`) don't count toward either side.
 */
export function runWideStepProgress(run: RunWithEvents): CountProgress {
  const rootArticleId = run.config.rootArticleId ?? run.articleIds[0] ?? null;
  const items: StagePlanItem[] = run.queueItems.length > 0
    ? run.queueItems
    : [{ depth: 0, startStep: runStartStep(run) }];
  const articleIds: Array<string | null> = run.queueItems.length > 0
    ? run.queueItems.map((item) => item.articleId)
    : [rootArticleId];

  let total = 0;
  let completed = 0;
  items.forEach((item, index) => {
    const stages = buildAgentStages(run, articleIds[index] ?? null);
    for (const step of STEP_ORDER) {
      if (!itemAppliesStep(item, step, run)) continue;
      total += 1;
      const stepStages = stages.filter((stage) => stage.step === step);
      if (stepStages.length > 0 && stepStages.every((stage) => stage.status === 'completed')) completed += 1;
    }
  });
  return { completed, total };
}

/**
 * Agent-pass completed/total from already-built stages. Each real agent role
 * appears once per step regardless of checker→revise retries, so this is an
 * estimated-pass count, not a raw call count. Stages switched off for this
 * item/run (`status: 'skipped'`) are excluded from both sides — they were
 * never going to run, so they shouldn't dilute the completion ratio.
 */
export function runAgentPassProgress(stages: AgentStage[]): CountProgress {
  const applicable = stages.filter((stage) => stage.status !== 'skipped');
  return { completed: applicable.filter((stage) => stage.status === 'completed').length, total: applicable.length };
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
    return stage.detail ?? `${stage.label} completed ${stageTaskLabel(stage).toLowerCase()}.`;
  }
  return `${stage.label} was skipped.`;
}

export function stageDiagnosticNote(stage: AgentStage): string {
  return stage.detail
    ?? stage.call?.errorMessage
    ?? (stage.status === 'pending'
      ? 'This stage has not run for the selected article yet.'
      : stage.status === 'running'
        ? 'This is the next expected MAS stage for the selected article.'
        : 'No additional details were recorded for this stage.');
}
