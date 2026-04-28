import { nanoid } from 'nanoid';
import { getDb } from '../db/index.js';
import { upsertEntry, getEntries } from '../services/worldBible.js';
import { mergeSections, splitSections } from '../services/sections.js';
import { buildContextPackage, type ArchivistMode } from '../services/archivist.js';
import { SkeletonAgent, type Stub } from './skeleton.js';
import { ProposalAgent, type ProposalItem } from './proposal.js';
import { ExpanderAgent } from './expander.js';
import { SummarizerAgent } from './summarizer.js';
import { ChildProposerAgent, type ChildProposalItem } from './childProposer.js';
import { CoherenceAgent, type CoherenceWarning, type SuggestedLink } from './coherence.js';
import { RetentionAgent, type RetentionIssue } from './retention.js';
import { ChroniclerAgent } from './chronicler.js';
import { BibleCompressorAgent, type CompressionEntry } from './bibleCompressor.js';
import type { ProposalMode } from '../prompts/proposal.js';
import type { ExpanderMode } from '../prompts/expander.js';

// ---------------------------------------------------------------------------
// WorldContext — three-parameter agent architecture
// ---------------------------------------------------------------------------

export interface WorldContext {
  worldId: string;
  name: string;
  tone: string;
  originPoint: string | null;
}

export function fetchWorldContext(worldId: string): WorldContext {
  const row = getDb()
    .prepare('SELECT id, name, tone, origin_point FROM worlds WHERE id = ?')
    .get(worldId) as Record<string, unknown> | undefined;

  if (!row) throw new Error(`World ${worldId} not found`);

  return {
    worldId,
    name: row.name as string,
    tone: row.tone as string,
    originPoint: (row.origin_point as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pipeline output types
// ---------------------------------------------------------------------------

export interface ProposeOutput {
  proposals: ProposalItem[];
  tokensIn: number;
  tokensOut: number;
}

export interface ExpandOutput {
  description: string;
  introduction: string;
  coherenceWarnings: CoherenceWarning[];
  suggestedLinks: SuggestedLink[];
  parentUpdate?: { appendText: string };
  temporalAnchor?: { start: string; end?: string } | null;
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
  tokensIn: number;
  tokensOut: number;
}

export interface CompressOutput {
  entries: CompressionEntry[];
  tokensIn: number;
  tokensOut: number;
}

// ---------------------------------------------------------------------------
// PipelineCoordinator
// ---------------------------------------------------------------------------

export class PipelineCoordinator {
  // ---------------------------------------------------------------------------
  // create_world pipeline (Block 6)
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

    const agent = new SkeletonAgent();
    const result = await agent.run(worldId, { seedText, categories });
    const { stubs } = result.output;

    const categoryMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const now = Date.now();

    db.transaction(() => {
      for (const stub of stubs) {
        const categoryId = categoryMap.get(stub.categoryName.toLowerCase());
        if (!categoryId) continue;

        const articleId = nanoid();
        const versionId = nanoid();
        const body = mergeSections('', '');

        db.prepare(
          `INSERT INTO articles
             (id, world_id, category_id, title, status, template_type,
              depth, current_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'stub', ?, 2, ?, ?, ?)`,
        ).run(articleId, worldId, categoryId, stub.title, stub.templateType, versionId, now, now);

        db.prepare(
          `INSERT INTO article_versions
             (id, article_id, version_number, body, summary, word_count, created_at)
           VALUES (?, ?, 1, ?, ?, 0, ?)`,
        ).run(versionId, articleId, body, stub.summary, now);

        upsertEntry(worldId, articleId, stub.summary);
      }
    })();

    return { stubs, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
  }

  // ---------------------------------------------------------------------------
  // Phase 1: propose — ProposalAgent
  // ---------------------------------------------------------------------------

  async propose(
    worldId: string,
    articleId: string,
    pipelineType: ProposalMode,
    userSpec?: string,
  ): Promise<ProposeOutput> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId);

    const agent = new ProposalAgent();
    const result = await agent.run(worldId, {
      contextPackage,
      worldContext,
      mode: pipelineType,
      userSpec,
    });

    return {
      proposals: result.output.proposals,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 2: expand — Expander → Summarizer → CoherenceAgent
  // ---------------------------------------------------------------------------

  async expand(
    worldId: string,
    articleId: string,
    pipelineType: ExpanderMode,
    selectedProposal: ProposalItem,
    userSpec?: string,
  ): Promise<ExpandOutput> {
    const worldContext = fetchWorldContext(worldId);
    const archivistMode: ArchivistMode = pipelineType === 'reorganize' ? 'reorganize' : 'default';
    const contextPackage = buildContextPackage(worldId, articleId, { mode: archivistMode });

    // Run Expander
    const expanderAgent = new ExpanderAgent();
    const expandResult = await expanderAgent.run(worldId, {
      contextPackage,
      worldContext,
      mode: pipelineType,
      selectedProposal,
      userSpec,
    });
    const expandOut = expandResult.output;

    const description = expandOut.mode === 'child'
      ? expandOut.childDescription
      : expandOut.description;
    const parentAppend = expandOut.mode === 'child' ? expandOut.parentAppend : undefined;
    const suggestedLinks = expandOut.suggestedLinks;
    const temporalAnchor = expandOut.temporalAnchor;

    // Run Summarizer (auto, derives Introduction from Description)
    const summarizerAgent = new SummarizerAgent();
    const sumResult = await summarizerAgent.run(worldId, {
      articleTitle: contextPackage.targetTitle,
      description,
      worldContext,
    });
    const introduction = sumResult.output.introduction;

    // Run CoherenceAgent
    const coherenceAgent = new CoherenceAgent();
    const coherenceResult = await coherenceAgent.run(worldId, {
      contextPackage,
      worldContext,
      newContent: description,
      contentLabel: 'Description',
    });

    const totalTokensIn = expandResult.tokensIn + sumResult.tokensIn + coherenceResult.tokensIn;
    const totalTokensOut = expandResult.tokensOut + sumResult.tokensOut + coherenceResult.tokensOut;

    const out: ExpandOutput = {
      description,
      introduction,
      coherenceWarnings: coherenceResult.output.warnings,
      suggestedLinks: [...suggestedLinks, ...coherenceResult.output.suggestedLinks],
      temporalAnchor,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
    };

    if (parentAppend) out.parentUpdate = { appendText: parentAppend };

    return out;
  }

  // ---------------------------------------------------------------------------
  // summarize (standalone) — Summarizer only
  // ---------------------------------------------------------------------------

  async summarize(
    worldId: string,
    articleId: string,
  ): Promise<SummarizeOutput> {
    const worldContext = fetchWorldContext(worldId);
    const db = getDb();

    const article = db
      .prepare(
        `SELECT a.title, av.body
         FROM articles a
         LEFT JOIN article_versions av ON av.id = a.current_version_id
         WHERE a.id = ? AND a.world_id = ?`,
      )
      .get(articleId, worldId) as { title: string; body: string } | undefined;

    if (!article) throw new Error(`Article ${articleId} not found`);

    const { description } = splitSections(article.body ?? '');

    const agent = new SummarizerAgent();
    const result = await agent.run(worldId, {
      articleTitle: article.title,
      description,
      worldContext,
    });

    return {
      introduction: result.output.introduction,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // propose_children — ChildProposer
  // ---------------------------------------------------------------------------

  async proposeChildren(
    worldId: string,
    articleId: string,
    userSpec?: string,
  ): Promise<ProposeChildrenOutput> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId, { mode: 'propose_children' });

    const agent = new ChildProposerAgent();
    const result = await agent.run(worldId, { contextPackage, worldContext, userSpec });

    return {
      proposals: result.output.proposals,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // reorganize — Expander [reorganize] → RetentionAgent → Summarizer
  // ---------------------------------------------------------------------------

  async reorganize(
    worldId: string,
    articleId: string,
  ): Promise<ReorganizeOutput> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId, { mode: 'reorganize' });

    // Expander in reorganize mode
    const expanderAgent = new ExpanderAgent();
    const expandResult = await expanderAgent.run(worldId, {
      contextPackage,
      worldContext,
      mode: 'reorganize',
    });
    const expandOut = expandResult.output;
    const description = expandOut.mode === 'single' ? expandOut.description : expandOut.childDescription;

    // RetentionAgent — compare original body vs reorganized description
    const retentionAgent = new RetentionAgent();
    const retentionResult = await retentionAgent.run(worldId, {
      articleTitle: contextPackage.targetTitle,
      originalBody: contextPackage.targetBody,
      reorganizedDescription: description,
      worldContext,
    });

    // Summarizer — refresh Introduction
    const summarizerAgent = new SummarizerAgent();
    const sumResult = await summarizerAgent.run(worldId, {
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
  // cohere (standalone) — CoherenceAgent
  // ---------------------------------------------------------------------------

  async cohere(
    worldId: string,
    articleId: string,
  ): Promise<{ warnings: CoherenceWarning[]; suggestedLinks: SuggestedLink[]; tokensIn: number; tokensOut: number }> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId);

    const agent = new CoherenceAgent();
    const result = await agent.run(worldId, {
      contextPackage,
      worldContext,
      newContent: contextPackage.targetBody,
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
  // expand_chronology — Chronicler → CoherenceAgent (Block 8)
  // ---------------------------------------------------------------------------

  async expandChronology(
    worldId: string,
    articleId: string,
    userSpec?: string,
  ): Promise<ChronologyOutput> {
    const worldContext = fetchWorldContext(worldId);
    const contextPackage = buildContextPackage(worldId, articleId, { mode: 'expand_chronology' });

    const chroniclerAgent = new ChroniclerAgent();
    const chroniclerResult = await chroniclerAgent.run(worldId, {
      contextPackage,
      worldContext,
      userSpec,
    });
    const { chronologySection } = chroniclerResult.output;

    const coherenceAgent = new CoherenceAgent();
    const coherenceResult = await coherenceAgent.run(worldId, {
      contextPackage,
      worldContext,
      newContent: chronologySection,
      contentLabel: 'Chronology',
    });

    return {
      chronologySection,
      coherenceWarnings: coherenceResult.output.warnings,
      suggestedLinks: coherenceResult.output.suggestedLinks,
      tokensIn: chroniclerResult.tokensIn + coherenceResult.tokensIn,
      tokensOut: chroniclerResult.tokensOut + coherenceResult.tokensOut,
    };
  }

  // ---------------------------------------------------------------------------
  // compress — BibleCompressor (preview only, Block 8)
  // ---------------------------------------------------------------------------

  async compress(worldId: string): Promise<CompressOutput> {
    const worldContext = fetchWorldContext(worldId);
    const bibleEntries = getEntries(worldId);

    const entries = bibleEntries.map((e) => ({
      articleId: e.articleId,
      title: e.articleTitle,
      summary: e.summary,
    }));

    const agent = new BibleCompressorAgent();
    const result = await agent.run(worldId, { worldContext, entries });

    return {
      entries: result.output.entries,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }
}
