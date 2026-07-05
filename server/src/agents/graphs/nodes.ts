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
import { LorekeepAgent } from '../lorekeeper.js';
import { StyleWardenAgent } from '../styleWarden.js';
import { CartographerAgent } from '../cartographer.js';
import { SentinelAgent } from '../sentinel.js';
import { ChroniclerAgent } from '../chronicler.js';
import { WardenAgent } from '../warden.js';
import { CondenserAgent } from '../condenser.js';
import { AuditorAgent } from '../auditor.js';
import type { OrchestrationState } from './state.js';

type Partial_ = Partial<OrchestrationState>;

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

export async function fetchWorldContextNode(state: OrchestrationState): Promise<Partial_> {
  return { worldContext: await fetchWorldContext(state.worldId) };
}

export async function buildContextPackageNode(state: OrchestrationState): Promise<Partial_> {
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
  });
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
  });
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
  });

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
  });

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
  });
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
  });
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
      });
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
        });
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
  });
  return { introduction: result.output.introduction, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

/**
 * Only runs when runStyleWarden is on — reused by expand() and
 * expandChronology(). Each pipeline graph invokes this node from fresh state,
 * so chronologySection is only ever set when the chronology pipeline's
 * chroniclerNode ran first; that's what distinguishes which content to check.
 */
export async function styleWardenNode(state: OrchestrationState): Promise<Partial_> {
  if (!state.runStyleWarden) return {};

  const content = state.chronologySection ?? state.description!;
  const contentLabel = state.chronologySection ? 'Chronology' : 'Description';

  const agent = new StyleWardenAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: state.contextPackage!.targetTitle,
    content,
    contentLabel,
    worldContext: state.worldContext!,
  });
  return { styleCheck: result.output, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// ---------------------------------------------------------------------------
// summarize (standalone) — Lorekeeper only
// ---------------------------------------------------------------------------

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

  const agent = new LorekeepAgent();
  const result = await agent.run(state.worldId, {
    articleTitle: article.title,
    description,
    worldContext: state.worldContext!,
    mode: effectiveMode,
    existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
  });

  return { introduction: result.output.introduction, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// ---------------------------------------------------------------------------
// propose_children — Cartographer
// ---------------------------------------------------------------------------

export async function cartographerNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new CartographerAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
    userSpec: state.userSpec,
  });
  return { childProposals: result.output.proposals, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
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
  });
  return { retentionIssues: result.output.issues, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// ---------------------------------------------------------------------------
// cohere / expand_chronology — Warden, Chronicler
// ---------------------------------------------------------------------------

export async function chroniclerNode(state: OrchestrationState): Promise<Partial_> {
  const agent = new ChroniclerAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
    userSpec: state.userSpec,
  });
  return { chronologySection: result.output.chronologySection, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

/**
 * Skips the LLM call entirely when the world bible is too sparse for a
 * coherence check to mean anything (hasSufficientBibleContent) — the same
 * guard director.ts's cohere() already has; expandChronology() gates this
 * node behind the same check, applied here too so both pipelines share it.
 */
export async function wardenNode(state: OrchestrationState): Promise<Partial_> {
  if (!(await hasSufficientBibleContent(state.worldId))) return { warnings: [], suggestedLinks: [] };

  const newContent = state.chronologySection ?? state.contextPackage!.targetDescription;
  const contentLabel = state.chronologySection ? 'Chronology' : 'Article Body';

  const agent = new WardenAgent();
  const result = await agent.run(state.worldId, {
    contextPackage: state.contextPackage!,
    worldContext: state.worldContext!,
    newContent,
    contentLabel,
  });
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
  const result = await agent.run(state.worldId, { worldContext: state.worldContext!, entries: state.bibleEntries });
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
  });
  return { edgeProposals: result.output.edgeProposals, globalWarnings: result.output.globalWarnings, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
