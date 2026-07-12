import { getDbClient } from '../../db/client.js';
import { buildContextPackage } from '../../services/archivist.js';
import { getEntries } from '../../services/worldBible.js';
import { fetchWorldContext } from '../director.js';
import { ArchitectAgent } from '../architect.js';
import { MuseAgent } from '../muse.js';
import { CuratorAgent } from '../curator.js';
import { OracleAgent } from '../oracle.js';
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

export async function museProposeNode(state: OrchestrationState): Promise<Partial_> {
  const pkg = state.contextPackage!;
  const agent = new MuseAgent();
  const result = await agent.run(state.worldId, {
    worldContext: state.worldContext!,
    mode: state.proposalMode!,
    articleTitle: pkg.targetTitle,
    templateType: pkg.targetTemplateType,
    currentIntroduction: pkg.targetIntroduction || undefined,
    userSpec: state.userSpec,
    researchBrief: state.researchBrief,
  }, callCtx(state));
  return { proposals: result.output.proposals, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

/** No-op when autoSelect is off or Muse produced no proposals — mirrors director.ts's `if (autoSelect && proposals.length > 0)` guard. */
export async function curatorAutoSelectNode(state: OrchestrationState): Promise<Partial_> {
  if (!state.autoSelect || state.proposals.length === 0) return {};

  const article = await getDbClient().get<{ title: string; template_type: string }>(
    'SELECT title, template_type FROM articles WHERE id = ? AND world_id = ?',
    [state.articleId, state.worldId],
  );

  const agent = new CuratorAgent();
  const result = await agent.run(state.worldId, {
    proposals: state.proposals,
    articleTitle: article?.title ?? '',
    articleTemplateType: article?.template_type ?? 'general',
    currentSummary: state.contextPackage?.targetIntroduction,
    worldContext: state.worldContext!,
  }, callCtx(state));

  return {
    autoSelectedIndex: result.output.selectedIndex,
    autoSelectRationale: result.output.rationale,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}

// ---------------------------------------------------------------------------
// proposeIdeas — Oracle
// ---------------------------------------------------------------------------

export async function oracleNode(state: OrchestrationState): Promise<Partial_> {
  const article = await getDbClient().get<{ title: string }>(
    'SELECT title FROM articles WHERE id = ? AND world_id = ?',
    [state.articleId, state.worldId],
  );

  const agent = new OracleAgent();
  const result = await agent.run(state.worldId, {
    worldContext: state.worldContext!,
    articleTitle: article?.title ?? state.contextPackage!.targetTitle,
    introduction: state.introduction!,
    selectedProposal: state.selectedProposal!,
    userSpec: state.userSpec,
    researchBrief: state.researchBrief,
  }, callCtx(state));

  return { ideas: result.output.ideas, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
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

/**
 * Scribe's draft plus, when runContinuityEditor is on and mode isn't
 * 'reorganize', a single self-correction pass — kept as one node (not split
 * into separate graph nodes/edges) since it's a tight, bounded, single-purpose
 * loop internal to producing one draft, not a multi-step pipeline stage in
 * its own right. Continuity Editor checks once; if it flags a contradiction,
 * Scribe gets one revision attempt and that revision is trusted without a
 * second check — deeper verification happens in Consolidate (Linter, Warden),
 * not here.
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
    selectedProposal: state.selectedProposal,
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
  if (state.runContinuityEditor && state.expanderMode !== 'reorganize') {
    const currentDesc = scribeOutput.mode === 'child' ? scribeOutput.childDescription : scribeOutput.description;
    const ceAgent = new ContinuityEditorAgent();
    const ceResult = await ceAgent.run(state.worldId, {
      worldContext: state.worldContext!,
      articleTitle: pkg.targetTitle,
      draft: currentDesc,
      researchBrief: state.researchBrief!,
    }, callCtx(state));
    tokensIn += ceResult.tokensIn;
    tokensOut += ceResult.tokensOut;
    continuityCheck = ceResult.output;

    if (!continuityCheck.approved && continuityCheck.contradictions.length > 0) {
      const correctionNote = continuityCheck.contradictions
        .map((c) => `- Excerpt: "${c.excerpt}"\n  Issue: ${c.issue}\n  Fix: ${c.correction}`)
        .join('\n');
      const revisionResult = await scribeAgent.run(state.worldId, {
        ...scribeFields,
        userSpec: [state.userSpec, `\n\n## Revision Required\nPlease correct the following contradictions:\n${correctionNote}`]
          .filter(Boolean).join(''),
      }, callCtx(state));
      tokensIn += revisionResult.tokensIn;
      tokensOut += revisionResult.tokensOut;
      scribeOutput = revisionResult.output;
    }
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
 * Lorekeeper's introduction plus, when runGroundingCheck is on, a single
 * Grounding Check self-correction pass — same bounded shape as scribeNode's
 * Continuity Editor pass. Grounding Check runs once; if it flags a
 * contradiction, Lorekeeper gets one revision attempt and that revision is
 * trusted without a second check or a commit-blocking gate — deeper
 * verification happens in Consolidate (Linter, Warden), not here.
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
  if (state.runGroundingCheck) {
    const gcAgent = new GroundingCheckAgent();
    const gcResult = await gcAgent.run(state.worldId, {
      worldContext: state.worldContext!,
      articleTitle: article.title,
      draft: introduction,
      researchBrief: state.researchBrief,
    }, callCtx(state));
    tokensIn += gcResult.tokensIn;
    tokensOut += gcResult.tokensOut;
    groundingCheck = gcResult.output;

    if (!groundingCheck.approved && groundingCheck.contradictions.length > 0) {
      const correctionNote = groundingCheck.contradictions
        .map((c) => `- Excerpt: "${c.excerpt}"\n  Issue: ${c.issue}\n  Fix: ${c.correction}`)
        .join('\n');
      const revisionResult = await lorekeeperAgent.run(state.worldId, {
        articleTitle: article.title,
        worldContext: state.worldContext!,
        mode: effectiveMode,
        existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
        revisionNotes: correctionNote,
        researchBrief: state.researchBrief,
      }, callCtx(state));
      tokensIn += revisionResult.tokensIn;
      tokensOut += revisionResult.tokensOut;
      introduction = revisionResult.output.introduction;
    }
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
 * Cartographer's proposals plus, when runDedupCheck is on, a Dedup Check pass
 * that filters out any proposals flagged as semantic duplicates of existing
 * siblings — shared by both Spark's manual "propose children" flow and
 * Forge's branchingNode, so both get the same protection from one
 * implementation.
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
  if (state.runDedupCheck && childProposals.length > 0) {
    const dedupAgent = new DedupCheckAgent();
    const dedupResult = await dedupAgent.run(state.worldId, {
      worldContext: state.worldContext!,
      articleTitle: pkg.targetTitle,
      existingChildren,
      proposals: childProposals,
    }, callCtx(state));
    tokensIn += dedupResult.tokensIn;
    tokensOut += dedupResult.tokensOut;
    dedupCheck = dedupResult.output;

    if (dedupCheck.duplicates.length > 0) {
      const flaggedTitles = new Set(dedupCheck.duplicates.map((d) => d.proposalTitle));
      childProposals = childProposals.filter((p) => !flaggedTitles.has(p.title));
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
