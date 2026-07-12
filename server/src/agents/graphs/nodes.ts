import { getDbClient } from '../../db/client.js';
import { buildContextPackage } from '../../services/archivist.js';
import { getEntries } from '../../services/worldBible.js';
import { fetchWorldContext } from '../director.js';
import { ArchitectAgent } from '../architect.js';
import { MuseAgent } from '../muse.js';
import { CuratorAgent } from '../curator.js';
import { ResearcherAgent } from '../researcher.js';
import { ScribeAgent } from '../scribe.js';
import { ContinuityEditorAgent } from '../continuityEditor.js';
import { GroundingCheckAgent } from '../groundingCheck.js';
import { LorekeepAgent } from '../lorekeeper.js';
import { StyleWardenAgent } from '../styleWarden.js';
import { CartographerAgent } from '../cartographer.js';
import { DedupCheckAgent } from '../dedupCheck.js';
import { SentinelAgent } from '../sentinel.js';
import { WardenAgent } from '../warden.js';
import { CondenserAgent } from '../condenser.js';
import { AuditorAgent } from '../auditor.js';
import { recordArticleIssues } from '../../services/issueRecorder.js';
import type { OrchestrationState } from './state.js';

type Partial_ = Partial<OrchestrationState>;

/** Shared call_log correlation context passed as every agent.run()'s third argument below. */
function callCtx(state: OrchestrationState): { pipelineRunId: string; pipelineType: string; articleId?: string; ownerId?: string } {
  return {
    pipelineRunId: state.pipelineRunId,
    pipelineType: state.pipelineType,
    articleId: state.articleId,
    ownerId: state.ownerId,
  };
}

/** Returns true if the world bible has enough entries for a coherence check to be meaningful. */
export async function hasSufficientBibleContent(worldId: string, ownerId?: string): Promise<boolean> {
  const row = await getDbClient().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM world_bible_entries WHERE world_id = ?${ownerId ? ' AND owner_id = ?' : ''} AND summary != ''`,
    ownerId ? [worldId, ownerId] : [worldId],
  );
  return row!.n >= 5;
}

// ---------------------------------------------------------------------------
// Common setup nodes — used at the start of nearly every pipeline graph
// ---------------------------------------------------------------------------

/**
 * Skips the fetch when a caller has already seeded worldContext (e.g. a
 * cached run-level value threaded in via graph.invoke()) — this guard is
 * shared by every pipeline graph's identical __start__ edge, so any future
 * caller must seed a real WorldContext for this worldId, never a stand-in.
 */
export async function fetchWorldContextNode(state: OrchestrationState): Promise<Partial_> {
  if (state.worldContext) return {};
  return { worldContext: await fetchWorldContext(state.worldId) };
}

/**
 * Skips the build when a caller has already seeded contextPackage. Shared by
 * every pipeline graph's identical __start__ edge — a seeded package MUST
 * have been built under the same ArchivistMode/contextDepth this call would
 * otherwise use, since ContextPackage carries no record of which mode built
 * it. Today only expansionNode (mode 'default') seeds this; do not thread a
 * cached package into proposeChildren.ts ('propose_children' mode) or a
 * 'reorganize'-mode call without adding a mode check first. Since
 * researchNode (graphs/pipelines/research.ts) now runs before Inception for
 * every Forge queue item, it is the primary producer for the whole
 * Research→Inception→Expansion cascade — expansionNode reuses its cached
 * package (see forgeGraph.ts's resolveItemContextPackage) instead of this
 * node rebuilding it a second time.
 *
 * The full package is still built here (Researcher genuinely needs its
 * neighborhood tiers), but as of v10 it's no longer *passed whole* to any
 * other Expand agent — every other node below extracts only the specific
 * fields (targetTitle, targetIntroduction, etc.) its agent actually needs
 * from `state.contextPackage`, relying on Researcher's brief for grounding
 * instead of re-rendering the raw parents/siblings/fixedPoints tiers.
 */
export async function buildContextPackageNode(state: OrchestrationState): Promise<Partial_> {
  if (state.contextPackage) return {};
  const contextPackage = await buildContextPackage(state.worldId, state.articleId!, {
    mode: state.contextMode,
    contextDepth: state.contextDepth,
  });
  return { contextPackage };
}

// ---------------------------------------------------------------------------
// createWorld — Architect
// ---------------------------------------------------------------------------

export async function architectNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new ArchitectAgent();
  const result = await agent.run(state.worldId, {
    seedText: state.seedText!,
    categories: state.categories,
    worldContext: state.worldContext,
  }, callCtx(state));
  return { stubs: result.output.stubs, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// ---------------------------------------------------------------------------
// propose — Muse (+ optional Curator auto-select)
// ---------------------------------------------------------------------------

/** Muse is grounding-only — world context, article identity, Researcher's brief. No userSpec: user preference enters downstream, via Curator. */
export async function museProposeNode(state: OrchestrationState): Promise<Partial_> {
  const pkg = state.contextPackage!;
  const agent = new MuseAgent();
  const result = await agent.run(state.worldId, {
    worldContext: state.worldContext!,
    mode: state.proposalMode!,
    articleTitle: pkg.targetTitle,
    templateType: pkg.targetTemplateType,
    currentIntroduction: pkg.targetIntroduction || undefined,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  return { ideas: result.output.ideas, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

/** No-op when autoSelect is off or Muse produced no ideas — mirrors director.ts's `if (autoSelect && ideas.length > 0)` guard. */
export async function curatorAutoSelectNode(state: OrchestrationState): Promise<Partial_> {
  if (!state.autoSelect || state.ideas.length === 0) return {};

  const article = await getDbClient().get<{ title: string; template_type: string }>(
    'SELECT title, template_type FROM articles WHERE id = ? AND world_id = ?',
    [state.articleId, state.worldId],
  );

  const agent = new CuratorAgent();
  const result = await agent.run(state.worldId, {
    ideas: state.ideas,
    articleTitle: article?.title ?? '',
    articleTemplateType: article?.template_type ?? 'general',
    currentSummary: state.contextPackage?.targetIntroduction,
    worldContext: state.worldContext!,
    userSpec: state.userSpec,
  }, callCtx(state));

  return {
    autoSelectedIndices: result.output.selectedIndices,
    autoSelectRationale: result.output.rationale,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}

// ---------------------------------------------------------------------------
// expand — Researcher -> Scribe [-> ContinuityEditor self-correction loop, up
// to 2 passes] -> optional Lorekeeper -> optional StyleWarden
// ---------------------------------------------------------------------------

/** No-op when researchBrief was already supplied externally (e.g. by researchNode running ahead of this pipeline in forgeGraph.ts) — mirrors fetchWorldContextNode/buildContextPackageNode's caching guards. */
export async function researcherNode(state: OrchestrationState): Promise<Partial_> {
  if (state.researchBrief) return {};
  const agent = new ResearcherAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
  }, callCtx(state));
  return { researchBrief: result.output, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

interface CheckOutcome {
  approved: boolean;
  contradictions: Array<{ excerpt: string; issue: string; correction: string }>;
}

function buildCorrectionNote(contradictions: CheckOutcome['contradictions']): string {
  return contradictions
    .map((c) => `- Excerpt: "${c.excerpt}"\n  Issue: ${c.issue}\n  Fix: ${c.correction}`)
    .join('\n');
}

/**
 * Shared N-cycle check→revise loop for Continuity Editor+Scribe and
 * Grounding Check+Lorekeeper — both check/revise a single draft string and
 * both output {approved, contradictions}, so one loop covers both.
 *
 * `level` (coherenceCheckLevel) <= 0 skips checking entirely. Otherwise runs
 * up to `level` check→revise cycles, stopping early the moment a check
 * approves; the last revision is never re-checked unless `safetyNet` adds one
 * more check-only pass at the end. A safety-net failure is flagged via
 * `onFlagged` but never blocks — the draft is returned as-is either way.
 * Deeper verification, if anything is still wrong, happens in Consolidate
 * (Linter, Warden), not here.
 */
async function runCheckReviseLoop(params: {
  level: number;
  safetyNet: boolean;
  initialDraft: string;
  check: (draft: string) => Promise<{ output: CheckOutcome; tokensIn: number; tokensOut: number }>;
  revise: (draft: string, correctionNote: string) => Promise<{ draft: string; tokensIn: number; tokensOut: number }>;
  onFlagged: (check: CheckOutcome) => Promise<void>;
}): Promise<{ draft: string; lastCheck?: CheckOutcome; tokensIn: number; tokensOut: number }> {
  let draft = params.initialDraft;
  let lastCheck: CheckOutcome | undefined;
  let tokensIn = 0;
  let tokensOut = 0;

  for (let cycle = 0; cycle < params.level; cycle++) {
    const checkResult = await params.check(draft);
    tokensIn += checkResult.tokensIn;
    tokensOut += checkResult.tokensOut;
    lastCheck = checkResult.output;

    if (lastCheck.approved || lastCheck.contradictions.length === 0) break;

    const revisionResult = await params.revise(draft, buildCorrectionNote(lastCheck.contradictions));
    tokensIn += revisionResult.tokensIn;
    tokensOut += revisionResult.tokensOut;
    draft = revisionResult.draft;
  }

  if (params.safetyNet && params.level > 0) {
    const finalCheck = await params.check(draft);
    tokensIn += finalCheck.tokensIn;
    tokensOut += finalCheck.tokensOut;
    lastCheck = finalCheck.output;
    if (!lastCheck.approved && lastCheck.contradictions.length > 0) {
      await params.onFlagged(lastCheck);
    }
  }

  return { draft, lastCheck, tokensIn, tokensOut };
}

/**
 * Scribe's draft plus, when coherenceCheckLevel > 0 and mode isn't
 * 'reorganize', a bounded Continuity Editor check→revise loop (see
 * runCheckReviseLoop) — kept as one node (not split into separate graph
 * nodes/edges) since it's a tight, single-purpose loop internal to producing
 * one draft, not a multi-step pipeline stage in its own right.
 */
export async function scribeNode(state: OrchestrationState): Promise<Partial_> {
  const pkg = state.contextPackage!;
  const scribeAgent = new ScribeAgent();
  const scribeFields = {
    worldContext: state.worldContext!,
    mode: state.expanderMode!,
    articleTitle: pkg.targetTitle,
    templateType: pkg.targetTemplateType,
    currentIntroduction: pkg.targetIntroduction || undefined,
    currentDescription: pkg.targetDescription || undefined,
    currentChronology: pkg.targetChronology || undefined,
    selectedIdeas: state.selectedIdeas,
    researchBrief: state.researchBrief,
    wordCountPreset: state.wordCountPreset,
  };
  const expandResult = await scribeAgent.run(state.worldId, {
    ...scribeFields,
    userSpec: state.userSpec,
  }, callCtx(state));
  let tokensIn = expandResult.tokensIn;
  let tokensOut = expandResult.tokensOut;
  let scribeOutput = expandResult.output;

  let continuityCheck: Partial_['continuityCheck'];
  if (state.coherenceCheckLevel > 0 && state.expanderMode !== 'reorganize') {
    const ceAgent = new ContinuityEditorAgent();
    const currentDraft = () => (scribeOutput.mode === 'child' ? scribeOutput.childDescription : scribeOutput.description);

    const loopResult = await runCheckReviseLoop({
      level: state.coherenceCheckLevel,
      safetyNet: state.safetyNet,
      initialDraft: currentDraft(),
      check: async (draft) => {
        const ceResult = await ceAgent.run(state.worldId, {
          worldContext: state.worldContext!,
          articleTitle: pkg.targetTitle,
          draft,
          researchBrief: state.researchBrief!,
        }, callCtx(state));
        return { output: ceResult.output, tokensIn: ceResult.tokensIn, tokensOut: ceResult.tokensOut };
      },
      revise: async (_draft, correctionNote) => {
        const revisionResult = await scribeAgent.run(state.worldId, {
          ...scribeFields,
          userSpec: [state.userSpec, `\n\n## Revision Required\nPlease correct the following contradictions:\n${correctionNote}`]
            .filter(Boolean).join(''),
        }, callCtx(state));
        scribeOutput = revisionResult.output;
        return { draft: currentDraft(), tokensIn: revisionResult.tokensIn, tokensOut: revisionResult.tokensOut };
      },
      onFlagged: async (check) => {
        if (!state.ownerId) return;
        await recordArticleIssues(getDbClient(), {
          worldId: state.worldId,
          ownerId: state.ownerId,
          articleId: state.articleId!,
          source: 'continuity_editor',
          issues: [{
            severity: 'info',
            code: 'CONTINUITY_UNRESOLVED_AFTER_SAFETY_NET',
            excerpt: check.contradictions[0]?.excerpt ?? null,
            explanation: `Continuity Editor still flagged contradictions after the safety-net pass: ${buildCorrectionNote(check.contradictions)}`,
          }],
        });
      },
    });
    tokensIn += loopResult.tokensIn;
    tokensOut += loopResult.tokensOut;
    continuityCheck = loopResult.lastCheck;
  }

  const description = scribeOutput.mode === 'child' ? scribeOutput.childDescription : scribeOutput.description;
  const parentAppend = scribeOutput.mode === 'child' ? scribeOutput.parentAppend : undefined;

  return {
    scribeOutput,
    description,
    ...(parentAppend ? { parentUpdate: { appendText: parentAppend } } : {}),
    mentions: [],
    ...(continuityCheck ? { continuityCheck } : {}),
    tokensIn,
    tokensOut,
  };
}

/**
 * Only runs for pipelineType === 'create_child' — mirrors director.ts's
 * expand() guard. Scribe's childDescription is already intro-shaped (~80
 * words, explicitly written to become the Introduction — see expander.ts's
 * create_child system prompt), so this uses it directly instead of routing
 * it through Lorekeeper: distilling a Description isn't Lorekeeper's job,
 * and Scribe already wrote something intro-shaped with full context. Zero
 * extra LLM call versus the previous "Scribe writes childDescription, then
 * Lorekeeper re-summarizes it" shape.
 */
export async function lorekeeperSummarizeAfterExpandNode(state: OrchestrationState): Promise<Partial_> {
  if (state.expanderMode !== 'create_child') return {};
  return { introduction: state.description! };
}

/** Always runs, no mode gate — used by reorganize(), which refreshes the introduction on every call from researchBrief/worldContext, not from the reorganized Description (outside Lorekeeper's scope). */
export async function lorekeeperSummarizeUnconditionalNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new LorekeepAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    worldContext: state.worldContext!,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  return { introduction: result.output.introduction, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

/** Only runs when runStyleWarden is on — reused by expand(). */
export async function styleWardenNode(state: OrchestrationState): Promise<Partial_> {
  if (!state.runStyleWarden) return {};

  const content = state.description!;
  const contentLabel = 'Description';

  const agent = new StyleWardenAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    content,
    contentLabel,
    worldContext: state.worldContext!,
  }, callCtx(state));
  return { styleCheck: result.output, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// ---------------------------------------------------------------------------
// summarize (standalone) — Lorekeeper only
// ---------------------------------------------------------------------------

/**
 * Lorekeeper's introduction plus, when coherenceCheckLevel > 0, a bounded
 * Grounding Check check→revise loop (see runCheckReviseLoop) — same shape as
 * scribeNode's Continuity Editor pass.
 */
export async function lorekeeperSummarizeNode(state: OrchestrationState): Promise<Partial_> {
  const article = await getDbClient().get<{ title: string; introduction: string }>(
    `SELECT a.title, av.introduction
     FROM articles a
     LEFT JOIN article_versions av ON av.id = a.current_version_id
     WHERE a.id = ? AND a.world_id = ?`,
    [state.articleId, state.worldId],
  );
  if (!article) throw new Error(`Article ${state.articleId} not found`);

  const existingIntro = article.introduction ?? '';
  const effectiveMode = state.lorekeeperMode === 'improve' && existingIntro.trim().length === 0 ? 'full' : state.lorekeeperMode;

  const lorekeeperAgent = new LorekeepAgent();
  const lorekeeperResult = await lorekeeperAgent.run(state.worldId, {
    articleTitle: article.title,
    worldContext: state.worldContext!,
    mode: effectiveMode,
    existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  let tokensIn = lorekeeperResult.tokensIn;
  let tokensOut = lorekeeperResult.tokensOut;
  let introduction = lorekeeperResult.output.introduction;

  let groundingCheck: Partial_['groundingCheck'];
  if (state.coherenceCheckLevel > 0) {
    const gcAgent = new GroundingCheckAgent();

    const loopResult = await runCheckReviseLoop({
      level: state.coherenceCheckLevel,
      safetyNet: state.safetyNet,
      initialDraft: introduction,
      check: async (draft) => {
        const gcResult = await gcAgent.run(state.worldId, {
          worldContext: state.worldContext!,
          articleTitle: article.title,
          draft,
          researchBrief: state.researchBrief,
        }, callCtx(state));
        return { output: gcResult.output, tokensIn: gcResult.tokensIn, tokensOut: gcResult.tokensOut };
      },
      revise: async (_draft, correctionNote) => {
        const revisionResult = await lorekeeperAgent.run(state.worldId, {
          articleTitle: article.title,
          worldContext: state.worldContext!,
          mode: effectiveMode,
          existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
          revisionNotes: correctionNote,
          researchBrief: state.researchBrief,
        }, callCtx(state));
        return { draft: revisionResult.output.introduction, tokensIn: revisionResult.tokensIn, tokensOut: revisionResult.tokensOut };
      },
      onFlagged: async (check) => {
        if (!state.ownerId) return;
        await recordArticleIssues(getDbClient(), {
          worldId: state.worldId,
          ownerId: state.ownerId,
          articleId: state.articleId!,
          source: 'grounding_check',
          issues: [{
            severity: 'info',
            code: 'GROUNDING_UNRESOLVED_AFTER_SAFETY_NET',
            excerpt: check.contradictions[0]?.excerpt ?? null,
            explanation: `Grounding Check still flagged contradictions after the safety-net pass: ${buildCorrectionNote(check.contradictions)}`,
          }],
        });
      },
    });
    tokensIn += loopResult.tokensIn;
    tokensOut += loopResult.tokensOut;
    introduction = loopResult.draft;
    groundingCheck = loopResult.lastCheck;
  }

  return {
    introduction,
    ...(groundingCheck ? { groundingCheck } : {}),
    tokensIn,
    tokensOut,
  };
}

// ---------------------------------------------------------------------------
// propose_children — Cartographer
// ---------------------------------------------------------------------------

/**
 * Cartographer's proposals plus, when coherenceCheckLevel > 0, a Dedup Check
 * loop that filters out proposals flagged as semantic duplicates of existing
 * siblings and, if cycles remain, re-runs Cartographer for fresh
 * replacements (excluding what's already known) — shared by both Spark's
 * manual "propose children" flow and Forge's branchingNode. Dedup Check's
 * shape (filter a list + regenerate) doesn't fit runCheckReviseLoop's
 * single-draft check/revise contract, so it has its own loop here.
 *
 * Filtering out a flagged duplicate always happens, even on the final
 * safety-net pass — there's no reason to keep a known duplicate just because
 * cycles ran out. The safety-net's "flag, don't block" behavior instead means
 * the resulting list may end up shorter than requested, and that gets
 * recorded via recordArticleIssues so Consolidate/the UI can see fewer
 * children were produced than asked for.
 */
export async function cartographerNode(state: OrchestrationState): Promise<Partial_> {
  const pkg = state.contextPackage!;
  const existingChildren = pkg.children.map((c) => ({ title: c.title, summary: c.summary }));

  const agent = new CartographerAgent();
  const result = await agent.run(state.worldId, {
    worldContext: state.worldContext!,
    articleTitle: pkg.targetTitle,
    templateType: pkg.targetTemplateType,
    currentIntroduction: pkg.targetIntroduction || undefined,
    currentDescription: pkg.targetDescription || undefined,
    existingChildren,
    userSpec: state.userSpec,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  let tokensIn = result.tokensIn;
  let tokensOut = result.tokensOut;
  let childProposals = result.output.proposals;

  let dedupCheck: Partial_['dedupCheck'];
  if (state.coherenceCheckLevel > 0 && childProposals.length > 0) {
    const dedupAgent = new DedupCheckAgent();
    const level = state.coherenceCheckLevel;

    for (let cycle = 0; cycle < level && childProposals.length > 0; cycle++) {
      const dedupResult = await dedupAgent.run(state.worldId, {
        worldContext: state.worldContext!,
        articleTitle: pkg.targetTitle,
        existingChildren,
        proposals: childProposals,
      }, callCtx(state));
      tokensIn += dedupResult.tokensIn;
      tokensOut += dedupResult.tokensOut;
      dedupCheck = dedupResult.output;

      if (dedupCheck.duplicates.length === 0) break;

      const flaggedTitles = new Set(dedupCheck.duplicates.map((d) => d.proposalTitle));
      childProposals = childProposals.filter((p) => !flaggedTitles.has(p.title));

      if (cycle >= level - 1) break;
      const regenResult = await agent.run(state.worldId, {
        worldContext: state.worldContext!,
        articleTitle: pkg.targetTitle,
        templateType: pkg.targetTemplateType,
        currentIntroduction: pkg.targetIntroduction || undefined,
        currentDescription: pkg.targetDescription || undefined,
        existingChildren: [...existingChildren, ...childProposals.map((p) => ({ title: p.title, summary: p.introduction }))],
        userSpec: state.userSpec,
        researchBrief: state.researchBrief,
      }, callCtx(state));
      tokensIn += regenResult.tokensIn;
      tokensOut += regenResult.tokensOut;
      childProposals = [...childProposals, ...regenResult.output.proposals];
    }

    if (state.safetyNet) {
      const finalCheck = await dedupAgent.run(state.worldId, {
        worldContext: state.worldContext!,
        articleTitle: pkg.targetTitle,
        existingChildren,
        proposals: childProposals,
      }, callCtx(state));
      tokensIn += finalCheck.tokensIn;
      tokensOut += finalCheck.tokensOut;
      dedupCheck = finalCheck.output;

      if (dedupCheck.duplicates.length > 0) {
        const flaggedTitles = new Set(dedupCheck.duplicates.map((d) => d.proposalTitle));
        childProposals = childProposals.filter((p) => !flaggedTitles.has(p.title));
        if (state.ownerId) {
          await recordArticleIssues(getDbClient(), {
            worldId: state.worldId,
            ownerId: state.ownerId,
            articleId: state.articleId!,
            source: 'dedup_check',
            issues: dedupCheck.duplicates.map((d) => ({
              severity: 'info',
              code: 'DUPLICATE_PROPOSAL_UNRESOLVED_AFTER_SAFETY_NET',
              explanation: `Proposed child "${d.proposalTitle}" filtered as a likely duplicate of existing article "${d.matchedExisting}" after the safety-net pass: ${d.rationale}`,
            })),
          });
        }
      }
    }
  }

  return {
    childProposals,
    ...(dedupCheck ? { dedupCheck } : {}),
    tokensIn,
    tokensOut,
  };
}

// ---------------------------------------------------------------------------
// reorganize — Scribe[reorganize] -> Sentinel -> Lorekeeper
// ---------------------------------------------------------------------------

export async function sentinelNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new SentinelAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    originalBody: state.contextPackage!.targetDescription,
    reorganizedDescription: state.description!,
    worldContext: state.worldContext!,
  }, callCtx(state));
  return { retentionIssues: result.output.issues, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// ---------------------------------------------------------------------------
// cohere — Warden
// ---------------------------------------------------------------------------

/**
 * Skips the LLM call entirely when the world bible is too sparse for a
 * coherence check to mean anything (hasSufficientBibleContent) — the same
 * guard director.ts's cohere() already has.
 */
export async function wardenNode(state: OrchestrationState): Promise<Partial_> {
  if (!(await hasSufficientBibleContent(state.worldId, state.ownerId))) return { warnings: [], suggestedLinks: [] };

  const newContent = state.contextPackage!.targetDescription;
  const contentLabel = 'Article Body';

  const agent = new WardenAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
    newContent,
    contentLabel,
  }, callCtx(state));
  return { warnings: result.output.warnings, suggestedLinks: result.output.suggestedLinks, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// ---------------------------------------------------------------------------
// compress — Condenser (preview only, no DB writes)
// ---------------------------------------------------------------------------

export async function loadBibleEntriesNode(state: OrchestrationState): Promise<Partial_> {
  const bibleEntries = await getEntries(state.worldId, state.ownerId);
  return {
    bibleEntries: bibleEntries.map((e) => ({ articleId: e.articleId, title: e.articleTitle, summary: e.summary })),
  };
}

export async function condenserNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new CondenserAgent();
  const result = await agent.run(state.worldId, { worldContext: state.worldContext!, entries: state.bibleEntries }, callCtx(state));
  return { compressedEntries: result.output.entries, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// ---------------------------------------------------------------------------
// audit — Auditor (world-wide coherence scan)
// ---------------------------------------------------------------------------

export async function loadAuditSummariesNode(state: OrchestrationState): Promise<Partial_> {
  const exec = getDbClient();

  let lastAuditTs = 0;
  if (state.focus === 'recent') {
    const lastRow = await exec.get<{ ts: number | null }>(
      `SELECT MAX(created_at) AS ts FROM world_issues WHERE world_id = ?${state.ownerId ? ' AND owner_id = ?' : ''}`,
      state.ownerId ? [state.worldId, state.ownerId] : [state.worldId],
    );
    lastAuditTs = lastRow?.ts ?? 0;
  }

  const articleFilters = [`a.world_id = ?`];
  const articleParams: unknown[] = [state.worldId];
  if (state.ownerId) {
    articleFilters.push(`a.owner_id = ?`);
    articleParams.push(state.ownerId);
  }
  if (state.focus === 'recent' && lastAuditTs > 0) {
    articleFilters.push(`a.updated_at > ?`);
    articleParams.push(lastAuditTs);
  }

  const rows = await exec.all<{ id: string; title: string; summary: string | null }>(
    `SELECT a.id, a.title, wbe.summary
     FROM articles a
     LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
     WHERE ${articleFilters.join(' AND ')}
     ORDER BY a.depth ASC, a.title ASC`,
    articleParams,
  );

  const linkRows = await exec.all<{
    source_article_id: string;
    target_article_id: string;
    link_type: string;
    target_title: string;
  }>(
    `SELECT al.source_article_id, al.target_article_id, al.link_type, a.title AS target_title
     FROM article_links al
     JOIN articles a ON a.id = al.target_article_id
     WHERE al.source_article_id IN (
       SELECT id FROM articles WHERE world_id = ?${state.ownerId ? ' AND owner_id = ?' : ''}
     )
       ${state.ownerId ? 'AND al.owner_id = ? AND a.owner_id = ?' : ''}`,
    state.ownerId ? [state.worldId, state.ownerId, state.ownerId, state.ownerId] : [state.worldId],
  );

  const linkMap = new Map<string, Array<{ targetId: string; targetTitle: string; linkType: string }>>();
  for (const row of linkRows) {
    if (!linkMap.has(row.source_article_id)) linkMap.set(row.source_article_id, []);
    linkMap.get(row.source_article_id)!.push({
      targetId: row.target_article_id,
      targetTitle: row.target_title,
      linkType: row.link_type,
    });
  }

  const articleSummaries = rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary ?? '',
    existingLinks: linkMap.get(r.id) ?? [],
  }));

  return { articleSummaries };
}

export async function auditorNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new AuditorAgent();
  const result = await agent.run(state.worldId, {
    worldContext: state.worldContext!,
    articleSummaries: state.articleSummaries,
    sampleSize: state.sampleSize,
  }, callCtx(state));
  return { edgeProposals: result.output.edgeProposals, globalWarnings: result.output.globalWarnings, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
