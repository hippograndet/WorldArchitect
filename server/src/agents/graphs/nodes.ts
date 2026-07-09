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
function callCtx(state: OrchestrationState): { pipelineRunId: string; pipelineType: string; articleId?: string } {
  return {
    pipelineRunId: state.pipelineRunId,
    pipelineType: state.pipelineType,
    articleId: state.articleId,
  };
}

/** Returns true if the world bible has enough entries for a coherence check to be meaningful. */
export async function hasSufficientBibleContent(worldId: string): Promise<boolean> {
  const row = await getDbClient().get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM world_bible_entries WHERE world_id = ? AND summary != ''",
    [worldId],
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
 * 'reorganize'-mode call without adding a mode check first.
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
  const agent = new MuseAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
    mode: state.proposalMode!,
    userSpec: state.userSpec,
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
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
    articleTitle: article?.title ?? state.contextPackage!.targetTitle,
    introduction: state.introduction!,
    selectedProposal: state.selectedProposal!,
    userSpec: state.userSpec,
  }, callCtx(state));

  return { ideas: result.output.ideas, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// ---------------------------------------------------------------------------
// expand — Researcher -> Scribe [-> ContinuityEditor self-correction loop, up
// to 2 passes] -> optional Lorekeeper -> optional StyleWarden
// ---------------------------------------------------------------------------

export async function researcherNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new ResearcherAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
  }, callCtx(state));
  return { researchBrief: result.output, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

/**
 * Scribe's draft plus, when runContinuityEditor is on and mode isn't
 * 'reorganize', up to 2 self-correction passes — kept as one node (not split
 * into separate graph nodes/edges) since it's a tight, bounded, single-purpose
 * retry loop internal to producing one draft, not a multi-step pipeline stage
 * in its own right. Near-verbatim port of director.ts's expand() body.
 */
export async function scribeNode(state: OrchestrationState): Promise<Partial_> {
  const scribeAgent = new ScribeAgent();
  const expandResult = await scribeAgent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
    mode: state.expanderMode!,
    selectedProposal: state.selectedProposal,
    userSpec: state.userSpec,
    selectedIdeas: state.selectedIdeas,
    researchBrief: state.researchBrief,
    wordCountPreset: state.wordCountPreset,
  }, callCtx(state));
  let tokensIn = expandResult.tokensIn;
  let tokensOut = expandResult.tokensOut;
  let scribeOutput = expandResult.output;

  let continuityCheck: Partial_['continuityCheck'];
  if (state.runContinuityEditor && state.expanderMode !== 'reorganize') {
    for (let pass = 0; pass < 2; pass++) {
      const currentDesc = scribeOutput.mode === 'child' ? scribeOutput.childDescription : scribeOutput.description;
      const ceAgent = new ContinuityEditorAgent();
      const ceResult = await ceAgent.run(state.worldId, {
        contextPackage: state.contextPackage!,
        worldContext: state.worldContext!,
        draft: currentDesc,
        researchBrief: state.researchBrief!,
      }, callCtx(state));
      tokensIn += ceResult.tokensIn;
      tokensOut += ceResult.tokensOut;
      continuityCheck = ceResult.output;

      if (continuityCheck.approved || continuityCheck.contradictions.length === 0) break;

      if (pass < 1) {
        const correctionNote = continuityCheck.contradictions
          .map((c) => `- Excerpt: "${c.excerpt}"\n  Issue: ${c.issue}\n  Fix: ${c.correction}`)
          .join('\n');
        const revisionResult = await scribeAgent.run(state.worldId, {
          contextPackage: state.contextPackage!,
          worldContext: state.worldContext!,
          mode: state.expanderMode!,
          selectedProposal: state.selectedProposal,
          userSpec: [state.userSpec, `\n\n## Revision Required\nPlease correct the following contradictions:\n${correctionNote}`]
            .filter(Boolean).join(''),
          selectedIdeas: state.selectedIdeas,
          researchBrief: state.researchBrief,
          wordCountPreset: state.wordCountPreset,
        }, callCtx(state));
        tokensIn += revisionResult.tokensIn;
        tokensOut += revisionResult.tokensOut;
        scribeOutput = revisionResult.output;
      }
    }
  }

  const description = scribeOutput.mode === 'child' ? scribeOutput.childDescription : scribeOutput.description;
  const parentAppend = scribeOutput.mode === 'child' ? scribeOutput.parentAppend : undefined;

  return {
    scribeOutput,
    description,
    ...(parentAppend ? { parentUpdate: { appendText: parentAppend } } : {}),
    mentions: scribeOutput.mentions,
    ...(continuityCheck ? { continuityCheck } : {}),
    tokensIn,
    tokensOut,
  };
}

/** Only runs for pipelineType === 'create_child' — mirrors director.ts's expand() guard. */
export async function lorekeeperSummarizeAfterExpandNode(state: OrchestrationState): Promise<Partial_> {
  if (state.expanderMode !== 'create_child') return {};
  return lorekeeperSummarizeUnconditionalNode(state);
}

/** Always runs, no mode gate — used by reorganize(), which summarizes on every call. */
export async function lorekeeperSummarizeUnconditionalNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new LorekeepAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    description: state.description!,
    worldContext: state.worldContext!,
    contextPackage: state.contextPackage!,
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
 * Lorekeeper's introduction plus, when runGroundingCheck is on, up to 2
 * Grounding Check self-correction passes — same bounded-retry shape as
 * scribeNode's Continuity Editor loop. Always returns the (possibly still
 * unapproved) introduction; the caller (forgeGraph.ts's inceptionNode)
 * decides whether to commit it to the World Bible based on groundingCheck.
 */
export async function lorekeeperSummarizeNode(state: OrchestrationState): Promise<Partial_> {
  const article = await getDbClient().get<{ title: string; description: string; introduction: string }>(
    `SELECT a.title, av.description, av.introduction
     FROM articles a
     LEFT JOIN article_versions av ON av.id = a.current_version_id
     WHERE a.id = ? AND a.world_id = ?`,
    [state.articleId, state.worldId],
  );
  if (!article) throw new Error(`Article ${state.articleId} not found`);

  const description = article.description ?? '';
  const existingIntro = article.introduction ?? '';
  const effectiveMode = state.lorekeeperMode === 'improve' && existingIntro.trim().length === 0 ? 'full' : state.lorekeeperMode;

  const lorekeeperAgent = new LorekeepAgent();
  const lorekeeperResult = await lorekeeperAgent.run(state.worldId, {
    articleTitle: article.title,
    description,
    worldContext: state.worldContext!,
    contextPackage: state.contextPackage!,
    mode: effectiveMode,
    existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
  }, callCtx(state));
  let tokensIn = lorekeeperResult.tokensIn;
  let tokensOut = lorekeeperResult.tokensOut;
  let introduction = lorekeeperResult.output.introduction;

  let groundingCheck: Partial_['groundingCheck'];
  if (state.runGroundingCheck) {
    for (let pass = 0; pass < 2; pass++) {
      const gcAgent = new GroundingCheckAgent();
      const gcResult = await gcAgent.run(state.worldId, {
        contextPackage: state.contextPackage!,
        worldContext: state.worldContext!,
        draft: introduction,
      }, callCtx(state));
      tokensIn += gcResult.tokensIn;
      tokensOut += gcResult.tokensOut;
      groundingCheck = gcResult.output;

      if (groundingCheck.approved || groundingCheck.contradictions.length === 0) break;

      if (pass < 1) {
        const correctionNote = groundingCheck.contradictions
          .map((c) => `- Excerpt: "${c.excerpt}"\n  Issue: ${c.issue}\n  Fix: ${c.correction}`)
          .join('\n');
        const revisionResult = await lorekeeperAgent.run(state.worldId, {
          articleTitle: article.title,
          description,
          worldContext: state.worldContext!,
          contextPackage: state.contextPackage!,
          mode: effectiveMode,
          existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
          revisionNotes: correctionNote,
        }, callCtx(state));
        tokensIn += revisionResult.tokensIn;
        tokensOut += revisionResult.tokensOut;
        introduction = revisionResult.output.introduction;
      }
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
  const agent = new CartographerAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
    userSpec: state.userSpec,
  }, callCtx(state));
  let tokensIn = result.tokensIn;
  let tokensOut = result.tokensOut;
  let childProposals = result.output.proposals;

  let dedupCheck: Partial_['dedupCheck'];
  if (state.runDedupCheck && childProposals.length > 0) {
    const dedupAgent = new DedupCheckAgent();
    const dedupResult = await dedupAgent.run(state.worldId, {
      contextPackage: state.contextPackage!,
      worldContext: state.worldContext!,
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
  if (!(await hasSufficientBibleContent(state.worldId))) return { warnings: [], suggestedLinks: [] };

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
  const bibleEntries = await getEntries(state.worldId);
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
      `SELECT MAX(created_at) AS ts FROM world_issues WHERE world_id = ?`,
      [state.worldId],
    );
    lastAuditTs = lastRow?.ts ?? 0;
  }

  const rows = await exec.all<{ id: string; title: string; summary: string | null }>(
    `SELECT a.id, a.title, wbe.summary
     FROM articles a
     LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
     WHERE a.world_id = ? ${state.focus === 'recent' && lastAuditTs > 0 ? 'AND a.updated_at > ?' : ''}
     ORDER BY a.depth ASC, a.title ASC`,
    [state.worldId, ...(state.focus === 'recent' && lastAuditTs > 0 ? [lastAuditTs] : [])],
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
     WHERE al.source_article_id IN (SELECT id FROM articles WHERE world_id = ?)`,
    [state.worldId],
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
