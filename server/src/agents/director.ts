import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { upsertEntry, getEntries } from '../services/worldBible.js';
import { buildContextPackage, type ArchivistMode, type ContextDepth } from '../services/archivist.js';
import { AppError } from '../middleware/errorHandler.js';
import { ArchitectAgent, type Stub } from './architect.js';
import { MuseAgent, type ProposalItem } from './muse.js';
import { ScribeAgent, type MentionItem } from './scribe.js';
import { LorekeepAgent, type LorekeepMode } from './lorekeeper.js';
import { CartographerAgent, type ChildProposalItem } from './cartographer.js';
import { WardenAgent, type CoherenceWarning, type SuggestedLink } from './warden.js';
import { SentinelAgent, type RetentionIssue } from './sentinel.js';
import { ChroniclerAgent } from './chronicler.js';
import { CondenserAgent, type CompressionEntry } from './condenser.js';
import { CuratorAgent } from './curator.js';
import { OracleAgent, type IdeaItem } from './oracle.js';
import { StyleWardenAgent, type StyleWardenOutput } from './styleWarden.js';
import { ResearcherAgent } from './researcher.js';
import { ContinuityEditorAgent, type ContinuityEditorOutput } from './continuityEditor.js';
import { AuditorAgent, type EdgeProposal, type GlobalWarning } from './auditor.js';
import type { ProposalMode } from '../prompts/proposal.js';
import type { ExpanderMode } from '../prompts/expander.js';
import type { AuditorArticleSummary } from '../prompts/auditor.js';
import type { WorldStyleConfig } from '../services/worldStylePresets.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if the world bible has enough entries for a coherence check to be meaningful. */
function hasSufficientBibleContent(worldId: string): boolean {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM world_bible_entries WHERE world_id = ? AND summary != ""')
    .get(worldId) as { n: number };
  return row.n >= 5;
}

// ---------------------------------------------------------------------------
// WorldContext — shared agent architecture
// ---------------------------------------------------------------------------

export interface WorldContext {
  worldId: string;
  name: string;
  tone: string;
  originPoint: string | null;
  styleConfig: WorldStyleConfig | null;
}

export function fetchWorldContext(worldId: string): WorldContext {
  const row = getDb()
    .prepare('SELECT id, name, tone, origin_point, style_config FROM worlds WHERE id = ?')
    .get(worldId) as Record<string, unknown> | undefined;

  if (!row) throw new Error(`World ${worldId} not found`);

  let styleConfig: WorldStyleConfig | null = null;
  try {
    const raw = JSON.parse((row.style_config as string) || '{}');
    if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
      styleConfig = raw as WorldStyleConfig;
    }
  } catch { /* ignore malformed JSON */ }

  return {
    worldId,
    name: row.name as string,
    tone: row.tone as string,
    originPoint: (row.origin_point as string | null) ?? null,
    styleConfig,
  };
}

// ---------------------------------------------------------------------------
// Pipeline output types
// ---------------------------------------------------------------------------

export interface ProposeOutput {
  proposals: ProposalItem[];
  autoSelectedIndex?: number;
  autoSelectRationale?: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ProposeIdeasOutput {
  ideas: IdeaItem[];
  tokensIn: number;
  tokensOut: number;
}

export interface ExpandOutput {
  description: string;
  introduction?: string;
  parentUpdate?: { appendText: string };
  styleCheck?: StyleWardenOutput;
  continuityCheck?: ContinuityEditorOutput;
  mentions?: MentionItem[];
  tokensIn: number;
  tokensOut: number;
}

export interface SummarizeOutput {
  introduction: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ProposeChildrenOutput {
  proposals: ChildProposalItem[];
  tokensIn: number;
  tokensOut: number;
}

export interface ReorganizeOutput {
  description: string;
  introduction: string;
  retentionIssues: RetentionIssue[];
  tokensIn: number;
  tokensOut: number;
}

export interface ChronologyOutput {
  chronologySection: string;
  coherenceWarnings: CoherenceWarning[];
  suggestedLinks: SuggestedLink[];
  styleCheck?: StyleWardenOutput;
  tokensIn: number;
  tokensOut: number;
}

export interface CompressOutput {
  entries: CompressionEntry[];
  tokensIn: number;
  tokensOut: number;
}

export interface AuditOutput {
  edgeProposals: EdgeProposal[];
  globalWarnings: GlobalWarning[];
  tokensIn: number;
  tokensOut: number;
}

// ---------------------------------------------------------------------------
// PipelineCoordinator
// ---------------------------------------------------------------------------

export class PipelineCoordinator {
  // ---------------------------------------------------------------------------
  // create_world pipeline — Architect
  // ---------------------------------------------------------------------------

  async createWorld(
    worldId: string,
    seedText: string,
  ): Promise<{ stubs: Stub[]; tokensIn: number; tokensOut: number }> {
    const db = getDb();

    const categories = db
      .prepare('SELECT id, name FROM categories WHERE world_id = ? ORDER BY sort_order')
      .all(worldId) as Array<{ id: string; name: string }>;

    if (categories.length === 0) throw new Error('World has no categories');

    const worldContext = fetchWorldContext(worldId);
    const agent = new ArchitectAgent();
    const result = await agent.run(worldId, { seedText, categories, worldContext });
    const { stubs } = result.output;

    const categoryMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const now = Date.now();

    db.transaction(() => {
      for (const stub of stubs) {
        const categoryId = categoryMap.get(stub.categoryName.toLowerCase());
        if (!categoryId) continue;

        const articleId = nanoid();
        const versionId = nanoid();

        db.prepare(
          `INSERT INTO articles
             (id, world_id, category_id, title, status, template_type,
              depth, current_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'stub', ?, 2, ?, ?, ?)`,
        ).run(articleId, worldId, categoryId, stub.title, stub.templateType, versionId, now, now);

        db.prepare(
          `INSERT INTO article_versions
             (id, article_id, version_number, introduction, description, chronology, word_count, created_at)
           VALUES (?, ?, 1, ?, '', '', 0, ?)`,
        ).run(versionId, articleId, stub.summary, now);

        upsertEntry(worldId, articleId, stub.summary);
      }
    })();

    return { stubs, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
  }

  // ---------------------------------------------------------------------------
  // Phase 1: propose — Muse (+ optional Curator auto-select)
  // ---------------------------------------------------------------------------

  async propose(
    worldId: string,
    articleId: string,
    pipelineType: ProposalMode,
    userSpec?: string,
    autoSelect = false,
    contextDepth: ContextDepth = 'mid',
  ): Promise<ProposeOutput> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId, { contextDepth });

    const agent = new MuseAgent();
    const result = await agent.run(worldId, {
      contextPackage,
      worldContext,
      mode: pipelineType,
      userSpec,
    });

    const proposals = result.output.proposals;
    let totalTokensIn  = result.tokensIn;
    let totalTokensOut = result.tokensOut;

    if (autoSelect && proposals.length > 0) {
      const article = getDb()
        .prepare('SELECT title, template_type FROM articles WHERE id = ? AND world_id = ?')
        .get(articleId, worldId) as { title: string; template_type: string } | undefined;

      const curatorAgent = new CuratorAgent();
      const curatorResult = await curatorAgent.run(worldId, {
        proposals,
        articleTitle: article?.title ?? '',
        articleTemplateType: article?.template_type ?? 'general',
        currentSummary: contextPackage.targetIntroduction,
        worldContext,
      });
      totalTokensIn  += curatorResult.tokensIn;
      totalTokensOut += curatorResult.tokensOut;

      return {
        proposals,
        autoSelectedIndex: curatorResult.output.selectedIndex,
        autoSelectRationale: curatorResult.output.rationale,
        tokensIn:  totalTokensIn,
        tokensOut: totalTokensOut,
      };
    }

    return {
      proposals,
      tokensIn:  totalTokensIn,
      tokensOut: totalTokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // Step B: proposeIdeas — Oracle
  // ---------------------------------------------------------------------------

  async proposeIdeas(
    worldId: string,
    articleId: string,
    introduction: string,
    selectedProposal: ProposalItem,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
  ): Promise<ProposeIdeasOutput> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId, { contextDepth });

    const article = getDb()
      .prepare('SELECT title FROM articles WHERE id = ? AND world_id = ?')
      .get(articleId, worldId) as { title: string } | undefined;

    const agent = new OracleAgent();
    const result = await agent.run(worldId, {
      contextPackage,
      worldContext,
      articleTitle: article?.title ?? contextPackage.targetTitle,
      introduction,
      selectedProposal,
      userSpec,
    });

    return {
      ideas: result.output.ideas,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 2: expand — Scribe → Lorekeeper → (optional StyleWarden)
  // ---------------------------------------------------------------------------

  async expand(
    worldId: string,
    articleId: string,
    pipelineType: ExpanderMode,
    selectedProposal: ProposalItem,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
    selectedIdeas?: IdeaItem[],
    runStyleWarden = false,
    runContinuityEditor = false,
    wordCountPreset: 'short' | 'medium' | 'long' = 'medium',
  ): Promise<ExpandOutput> {
    const worldContext = fetchWorldContext(worldId);
    const archivistMode: ArchivistMode = pipelineType === 'reorganize' ? 'reorganize' : 'default';
    const contextPackage = buildContextPackage(worldId, articleId, { mode: archivistMode, contextDepth });

    // Researcher (always-on): build constraint brief before Scribe writes
    const researcherAgent = new ResearcherAgent();
    const researchResult = await researcherAgent.run(worldId, { contextPackage, worldContext });
    const researchBrief = researchResult.output;
    let tokensIn  = researchResult.tokensIn;
    let tokensOut = researchResult.tokensOut;

    const scribeAgent = new ScribeAgent();
    const expandResult = await scribeAgent.run(worldId, {
      contextPackage, worldContext, mode: pipelineType, selectedProposal, userSpec, selectedIdeas, researchBrief,
      wordCountPreset,
    });
    tokensIn  += expandResult.tokensIn;
    tokensOut += expandResult.tokensOut;
    let expandOut = expandResult.output;

    // Continuity Editor (opt-in): self-correction pass, up to 2 attempts
    let continuityCheck: ContinuityEditorOutput | undefined;
    if (runContinuityEditor && pipelineType !== 'reorganize') {
      for (let pass = 0; pass < 2; pass++) {
        const currentDesc = expandOut.mode === 'child' ? expandOut.childDescription : expandOut.description;
        const ceAgent = new ContinuityEditorAgent();
        const ceResult = await ceAgent.run(worldId, {
          contextPackage, worldContext, draft: currentDesc, researchBrief,
        });
        tokensIn  += ceResult.tokensIn;
        tokensOut += ceResult.tokensOut;
        continuityCheck = ceResult.output;

        if (continuityCheck.approved || continuityCheck.contradictions.length === 0) break;

        // If contradictions found and not last pass, ask Scribe to revise
        if (pass < 1) {
          const correctionNote = continuityCheck.contradictions
            .map(c => `- Excerpt: "${c.excerpt}"\n  Issue: ${c.issue}\n  Fix: ${c.correction}`)
            .join('\n');
          const revisionResult = await scribeAgent.run(worldId, {
            contextPackage,
            worldContext,
            mode: pipelineType,
            selectedProposal,
            userSpec: [userSpec, `\n\n## Revision Required\nPlease correct the following contradictions:\n${correctionNote}`]
              .filter(Boolean).join(''),
            selectedIdeas,
            researchBrief,
            wordCountPreset,
          });
          tokensIn  += revisionResult.tokensIn;
          tokensOut += revisionResult.tokensOut;
          expandOut = revisionResult.output;
        }
      }
    }

    const description = expandOut.mode === 'child' ? expandOut.childDescription : expandOut.description;
    const parentAppend = expandOut.mode === 'child' ? expandOut.parentAppend : undefined;
    const mentions = expandOut.mentions;

    let introduction: string | undefined;

    if (pipelineType === 'create_child') {
      const lorekeepAgent = new LorekeepAgent();
      const sumResult = await lorekeepAgent.run(worldId, {
        articleTitle: contextPackage.targetTitle,
        description,
        worldContext,
      });
      introduction = sumResult.output.introduction;
      tokensIn  += sumResult.tokensIn;
      tokensOut += sumResult.tokensOut;
    }

    let styleCheck: StyleWardenOutput | undefined;
    if (runStyleWarden) {
      const styleAgent = new StyleWardenAgent();
      const styleResult = await styleAgent.run(worldId, {
        articleTitle: contextPackage.targetTitle,
        content: description,
        contentLabel: 'Description',
        worldContext,
      });
      styleCheck = styleResult.output;
      tokensIn  += styleResult.tokensIn;
      tokensOut += styleResult.tokensOut;
    }

    return {
      description,
      ...(introduction !== undefined ? { introduction } : {}),
      ...(parentAppend ? { parentUpdate: { appendText: parentAppend } } : {}),
      ...(styleCheck ? { styleCheck } : {}),
      ...(continuityCheck ? { continuityCheck } : {}),
      ...(mentions?.length ? { mentions } : {}),
      tokensIn,
      tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // summarize (standalone) — Lorekeeper only
  // ---------------------------------------------------------------------------

  async summarize(
    worldId: string,
    articleId: string,
    mode: LorekeepMode = 'full',
  ): Promise<SummarizeOutput> {
    const worldContext = fetchWorldContext(worldId);
    const db = getDb();

    const article = db
      .prepare(
        `SELECT a.title, av.description, av.introduction
         FROM articles a
         LEFT JOIN article_versions av ON av.id = a.current_version_id
         WHERE a.id = ? AND a.world_id = ?`,
      )
      .get(articleId, worldId) as { title: string; description: string; introduction: string } | undefined;

    if (!article) throw new Error(`Article ${articleId} not found`);

    const description = article.description ?? '';
    const existingIntro = article.introduction ?? '';

    const effectiveMode: LorekeepMode =
      mode === 'improve' && existingIntro.trim().length === 0 ? 'full' : mode;

    const agent = new LorekeepAgent();
    const result = await agent.run(worldId, {
      articleTitle: article.title,
      description,
      worldContext,
      mode: effectiveMode,
      existingIntro: effectiveMode === 'improve' ? existingIntro : undefined,
    });

    return {
      introduction: result.output.introduction,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // propose_children — Cartographer
  // ---------------------------------------------------------------------------

  async proposeChildren(
    worldId: string,
    articleId: string,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
  ): Promise<ProposeChildrenOutput> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId, { mode: 'propose_children', contextDepth });

    const agent = new CartographerAgent();
    const result = await agent.run(worldId, { contextPackage, worldContext, userSpec });

    return {
      proposals: result.output.proposals,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // reorganize — Scribe [reorganize] → Sentinel → Lorekeeper
  // ---------------------------------------------------------------------------

  async reorganize(
    worldId: string,
    articleId: string,
    contextDepth: ContextDepth = 'mid',
  ): Promise<ReorganizeOutput> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId, { mode: 'reorganize', contextDepth });

    const scribeAgent = new ScribeAgent();
    const expandResult = await scribeAgent.run(worldId, {
      contextPackage,
      worldContext,
      mode: 'reorganize',
    });
    const expandOut = expandResult.output;
    const description = expandOut.mode === 'single' ? expandOut.description : expandOut.childDescription;

    const sentinelAgent = new SentinelAgent();
    const retentionResult = await sentinelAgent.run(worldId, {
      articleTitle: contextPackage.targetTitle,
      originalBody: contextPackage.targetDescription,
      reorganizedDescription: description,
      worldContext,
    });

    const lorekeepAgent = new LorekeepAgent();
    const sumResult = await lorekeepAgent.run(worldId, {
      articleTitle: contextPackage.targetTitle,
      description,
      worldContext,
    });

    return {
      description,
      introduction: sumResult.output.introduction,
      retentionIssues: retentionResult.output.issues,
      tokensIn: expandResult.tokensIn + retentionResult.tokensIn + sumResult.tokensIn,
      tokensOut: expandResult.tokensOut + retentionResult.tokensOut + sumResult.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // cohere (standalone) — Warden
  // ---------------------------------------------------------------------------

  async cohere(
    worldId: string,
    articleId: string,
    contextDepth: ContextDepth = 'mid',
  ): Promise<{ warnings: CoherenceWarning[]; suggestedLinks: SuggestedLink[]; tokensIn: number; tokensOut: number }> {
    if (!hasSufficientBibleContent(worldId)) {
      return { warnings: [], suggestedLinks: [], tokensIn: 0, tokensOut: 0 };
    }

    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId, { contextDepth });

    const agent = new WardenAgent();
    const result = await agent.run(worldId, {
      contextPackage,
      worldContext,
      newContent: contextPackage.targetDescription,
      contentLabel: 'Article Body',
    });

    return {
      warnings: result.output.warnings,
      suggestedLinks: result.output.suggestedLinks,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // expand_chronology — Chronicler → Warden → (optional StyleWarden)
  // ---------------------------------------------------------------------------

  async expandChronology(
    worldId: string,
    articleId: string,
    userSpec?: string,
    contextDepth: ContextDepth = 'mid',
    runStyleWarden = false,
  ): Promise<ChronologyOutput> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId, { mode: 'expand_chronology', contextDepth });

    const chroniclerAgent = new ChroniclerAgent();
    const chroniclerResult = await chroniclerAgent.run(worldId, {
      contextPackage,
      worldContext,
      userSpec,
    });
    const { chronologySection } = chroniclerResult.output;

    let tokensIn  = chroniclerResult.tokensIn;
    let tokensOut = chroniclerResult.tokensOut;
    let coherenceWarnings: CoherenceWarning[] = [];
    let suggestedLinks: SuggestedLink[] = [];

    if (hasSufficientBibleContent(worldId)) {
      const wardenAgent = new WardenAgent();
      const coherenceResult = await wardenAgent.run(worldId, {
        contextPackage,
        worldContext,
        newContent: chronologySection,
        contentLabel: 'Chronology',
      });
      coherenceWarnings = coherenceResult.output.warnings;
      suggestedLinks    = coherenceResult.output.suggestedLinks;
      tokensIn  += coherenceResult.tokensIn;
      tokensOut += coherenceResult.tokensOut;
    }
    let styleCheck: StyleWardenOutput | undefined;

    if (runStyleWarden) {
      const styleAgent = new StyleWardenAgent();
      const styleResult = await styleAgent.run(worldId, {
        articleTitle: contextPackage.targetTitle,
        content: chronologySection,
        contentLabel: 'Chronology',
        worldContext,
      });
      styleCheck = styleResult.output;
      tokensIn  += styleResult.tokensIn;
      tokensOut += styleResult.tokensOut;
    }

    return {
      chronologySection,
      coherenceWarnings,
      suggestedLinks,
      ...(styleCheck ? { styleCheck } : {}),
      tokensIn,
      tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // compress — Condenser (preview only)
  // ---------------------------------------------------------------------------

  async compress(worldId: string): Promise<CompressOutput> {
    const worldContext = fetchWorldContext(worldId);
    const bibleEntries = getEntries(worldId);

    const entries = bibleEntries.map((e) => ({
      articleId: e.articleId,
      title: e.articleTitle,
      summary: e.summary,
    }));

    const agent = new CondenserAgent();
    const result = await agent.run(worldId, { worldContext, entries });

    return {
      entries: result.output.entries,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // audit — Auditor (world-wide coherence scan)
  // ---------------------------------------------------------------------------

  async audit(worldId: string, sampleSize?: number, focus: 'all' | 'recent' = 'all'): Promise<AuditOutput> {
    const worldContext = fetchWorldContext(worldId);
    const db = getDb();

    let lastAuditTs = 0;
    if (focus === 'recent') {
      const lastRow = db.prepare(
        `SELECT MAX(created_at) AS ts FROM world_issues WHERE world_id = ?`,
      ).get(worldId) as { ts: number | null };
      lastAuditTs = lastRow?.ts ?? 0;
    }

    const rows = db.prepare(
      `SELECT a.id, a.title, wbe.summary
       FROM articles a
       LEFT JOIN world_bible_entries wbe ON wbe.article_id = a.id
       WHERE a.world_id = ? ${focus === 'recent' && lastAuditTs > 0 ? 'AND a.updated_at > ?' : ''}
       ORDER BY a.depth ASC, a.title ASC`,
    ).all(worldId, ...(focus === 'recent' && lastAuditTs > 0 ? [lastAuditTs] : [])) as Array<{ id: string; title: string; summary: string | null }>;

    const linkRows = db.prepare(
      `SELECT al.source_article_id, al.target_article_id, al.link_type, a.title AS target_title
       FROM article_links al
       JOIN articles a ON a.id = al.target_article_id
       WHERE al.source_article_id IN (
         SELECT id FROM articles WHERE world_id = ?
       )`,
    ).all(worldId) as Array<{
      source_article_id: string;
      target_article_id: string;
      link_type: string;
      target_title: string;
    }>;

    const linkMap = new Map<string, Array<{ targetId: string; targetTitle: string; linkType: string }>>();
    for (const row of linkRows) {
      if (!linkMap.has(row.source_article_id)) linkMap.set(row.source_article_id, []);
      linkMap.get(row.source_article_id)!.push({
        targetId: row.target_article_id,
        targetTitle: row.target_title,
        linkType: row.link_type,
      });
    }

    const articleSummaries: AuditorArticleSummary[] = rows.map(r => ({
      id: r.id,
      title: r.title,
      summary: r.summary ?? '',
      existingLinks: linkMap.get(r.id) ?? [],
    }));

    const agent = new AuditorAgent();
    const result = await agent.run(worldId, { worldContext, articleSummaries, sampleSize });

    return {
      edgeProposals: result.output.edgeProposals,
      globalWarnings: result.output.globalWarnings,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }
}
