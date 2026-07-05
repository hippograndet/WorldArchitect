import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema, runMigrations } from '../../db/schema.js';

const dbRef = vi.hoisted(() => ({ db: null as Database.Database | null }));

vi.mock('../../db/index.js', () => ({
  getDb: () => dbRef.db!,
  DB_PATH: ':memory:',
}));

import { MuseAgent } from '../muse.js';
import { CuratorAgent } from '../curator.js';
import { ScribeAgent } from '../scribe.js';
import { ContinuityEditorAgent } from '../continuityEditor.js';
import { WardenAgent } from '../warden.js';
import { ArchitectAgent } from '../architect.js';
import {
  hasSufficientBibleContent,
  museProposeNode,
  curatorAutoSelectNode,
  scribeNode,
  wardenNode,
  architectNode,
} from './nodes.js';
import type { OrchestrationState } from './state.js';
import type { WorldContext } from '../director.js';

const worldContext: WorldContext = {
  worldId: 'world1',
  name: 'Test World',
  tone: 'neutral',
  originPoint: null,
  styleConfig: null,
};

function baseState(overrides: Partial<OrchestrationState> = {}): OrchestrationState {
  return {
    worldId: 'world1',
    articleId: 'art1',
    worldContext,
    contextPackage: undefined,
    contextDepth: 'mid',
    userSpec: undefined,
    tokensIn: 0,
    tokensOut: 0,
    seedText: undefined,
    categories: [],
    stubs: [],
    proposalMode: undefined,
    autoSelect: false,
    proposals: [],
    autoSelectedIndex: undefined,
    autoSelectRationale: undefined,
    introduction: undefined,
    selectedProposal: undefined,
    ideas: [],
    expanderMode: undefined,
    selectedIdeas: undefined,
    runStyleWarden: false,
    runContinuityEditor: false,
    wordCountPreset: 'medium',
    researchBrief: undefined,
    scribeOutput: undefined,
    continuityCheck: undefined,
    description: undefined,
    parentUpdate: undefined,
    styleCheck: undefined,
    mentions: undefined,
    lorekeeperMode: 'full',
    existingIntro: undefined,
    childProposals: [],
    retentionIssues: [],
    warnings: [],
    suggestedLinks: [],
    chronologySection: undefined,
    bibleEntries: [],
    compressedEntries: [],
    sampleSize: undefined,
    focus: 'all',
    articleSummaries: [],
    edgeProposals: [],
    globalWarnings: [],
    ...overrides,
  } as OrchestrationState;
}

beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  runMigrations(db);
  dbRef.db = db;

  const now = Date.now();
  db.prepare(`INSERT INTO worlds (id, name, description, tags, tone, created_at, updated_at)
    VALUES ('world1', 'TestWorld', 'desc', '[]', 'narrative', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO categories (id, world_id, name, sort_order, created_at)
    VALUES ('cat1', 'world1', 'Lore', 0, ?)`).run(now);
  db.prepare(`INSERT INTO articles (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
    VALUES ('art1', 'world1', 'cat1', 'Article One', 'draft', 'general', NULL, ?, ?)`).run(now, now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hasSufficientBibleContent', () => {
  it('returns false with fewer than 5 non-empty bible entries', async () => {
    dbRef.db!.exec(`DELETE FROM world_bible_entries`);
    expect(await hasSufficientBibleContent('world1')).toBe(false);
  });

  it('returns true once 5+ non-empty entries exist', async () => {
    dbRef.db!.exec(`DELETE FROM world_bible_entries`);
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const aid = `bible-art-${i}`;
      dbRef.db!.prepare(`INSERT OR IGNORE INTO articles (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
        VALUES (?, 'world1', 'cat1', ?, 'draft', 'general', NULL, ?, ?)`).run(aid, aid, now, now);
      dbRef.db!.prepare(`INSERT INTO world_bible_entries (id, world_id, article_id, summary, sort_order, updated_at)
        VALUES (?, 'world1', ?, 'a summary', ?, ?)`).run(`entry-${i}`, aid, i, now);
    }
    expect(await hasSufficientBibleContent('world1')).toBe(true);
  });
});

describe('museProposeNode', () => {
  it('calls Muse with the mode/userSpec from state and returns its proposals', async () => {
    const runSpy = vi.spyOn(MuseAgent.prototype, 'run').mockResolvedValue({
      output: { proposals: [{ title: 'A', direction: 'B' }] },
      tokensIn: 10,
      tokensOut: 5,
    });

    const state = baseState({ proposalMode: 'expand_description', userSpec: 'more drama' });
    const result = await museProposeNode(state);

    expect(runSpy).toHaveBeenCalledWith('world1', expect.objectContaining({ mode: 'expand_description', userSpec: 'more drama' }));
    expect(result.proposals).toEqual([{ title: 'A', direction: 'B' }]);
    expect(result.tokensIn).toBe(10);
    expect(result.tokensOut).toBe(5);
  });
});

describe('curatorAutoSelectNode', () => {
  it('does nothing when autoSelect is off', async () => {
    const runSpy = vi.spyOn(CuratorAgent.prototype, 'run');
    const state = baseState({ autoSelect: false, proposals: [{ title: 'A', direction: 'B' }] });
    const result = await curatorAutoSelectNode(state);
    expect(runSpy).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('does nothing when there are no proposals, even with autoSelect on', async () => {
    const runSpy = vi.spyOn(CuratorAgent.prototype, 'run');
    const state = baseState({ autoSelect: true, proposals: [] });
    const result = await curatorAutoSelectNode(state);
    expect(runSpy).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('calls Curator and returns its selection when autoSelect is on with proposals present', async () => {
    vi.spyOn(CuratorAgent.prototype, 'run').mockResolvedValue({
      output: { selectedIndex: 1, rationale: 'best fit' },
      tokensIn: 3,
      tokensOut: 2,
    });
    const state = baseState({ autoSelect: true, proposals: [{ title: 'A', direction: 'x' }, { title: 'B', direction: 'y' }] });
    const result = await curatorAutoSelectNode(state);
    expect(result.autoSelectedIndex).toBe(1);
    expect(result.autoSelectRationale).toBe('best fit');
  });
});

describe('scribeNode', () => {
  it('returns Scribe output directly when runContinuityEditor is off', async () => {
    vi.spyOn(ScribeAgent.prototype, 'run').mockResolvedValue({
      output: { mode: 'single', description: 'A draft.' },
      tokensIn: 20,
      tokensOut: 15,
    });
    const ceSpy = vi.spyOn(ContinuityEditorAgent.prototype, 'run');

    const state = baseState({ expanderMode: 'expand_description', runContinuityEditor: false });
    const result = await scribeNode(state);

    expect(ceSpy).not.toHaveBeenCalled();
    expect(result.description).toBe('A draft.');
    expect(result.tokensIn).toBe(20);
  });

  it('stops after one ContinuityEditor pass once approved', async () => {
    vi.spyOn(ScribeAgent.prototype, 'run').mockResolvedValue({
      output: { mode: 'single', description: 'A draft.' },
      tokensIn: 20,
      tokensOut: 15,
    });
    const ceSpy = vi.spyOn(ContinuityEditorAgent.prototype, 'run').mockResolvedValue({
      output: { approved: true, contradictions: [] },
      tokensIn: 5,
      tokensOut: 3,
    });

    const state = baseState({
      expanderMode: 'expand_description',
      runContinuityEditor: true,
      researchBrief: { keyFacts: [], warnings: [], suggestedAngles: [] },
    });
    const result = await scribeNode(state);

    expect(ceSpy).toHaveBeenCalledTimes(1);
    expect(result.continuityCheck).toEqual({ approved: true, contradictions: [] });
    expect(result.description).toBe('A draft.');
  });

  it('asks Scribe to revise once on a contradiction, then stops at the 2nd ContinuityEditor pass', async () => {
    const scribeSpy = vi.spyOn(ScribeAgent.prototype, 'run')
      .mockResolvedValueOnce({ output: { mode: 'single', description: 'First draft.' }, tokensIn: 20, tokensOut: 15 })
      .mockResolvedValueOnce({ output: { mode: 'single', description: 'Revised draft.' }, tokensIn: 22, tokensOut: 16 });

    const ceSpy = vi.spyOn(ContinuityEditorAgent.prototype, 'run')
      .mockResolvedValueOnce({
        output: { approved: false, contradictions: [{ excerpt: 'x', issue: 'y', correction: 'z' }] },
        tokensIn: 5, tokensOut: 3,
      })
      .mockResolvedValueOnce({ output: { approved: true, contradictions: [] }, tokensIn: 5, tokensOut: 3 });

    const state = baseState({
      expanderMode: 'expand_description',
      runContinuityEditor: true,
      researchBrief: { keyFacts: [], warnings: [], suggestedAngles: [] },
    });
    const result = await scribeNode(state);

    expect(scribeSpy).toHaveBeenCalledTimes(2);
    expect(ceSpy).toHaveBeenCalledTimes(2);
    expect(result.description).toBe('Revised draft.');
  });

  it('never runs ContinuityEditor for reorganize mode even when runContinuityEditor is on', async () => {
    vi.spyOn(ScribeAgent.prototype, 'run').mockResolvedValue({
      output: { mode: 'single', description: 'Reorganized.' },
      tokensIn: 20,
      tokensOut: 15,
    });
    const ceSpy = vi.spyOn(ContinuityEditorAgent.prototype, 'run');

    const state = baseState({ expanderMode: 'reorganize', runContinuityEditor: true });
    await scribeNode(state);

    expect(ceSpy).not.toHaveBeenCalled();
  });
});

describe('wardenNode', () => {
  it('skips the Warden call entirely when the world bible is too sparse', async () => {
    dbRef.db!.exec(`DELETE FROM world_bible_entries`);
    const runSpy = vi.spyOn(WardenAgent.prototype, 'run');

    const state = baseState({ contextPackage: { targetTitle: 't', targetDescription: 'd' } as never });
    const result = await wardenNode(state);

    expect(runSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ warnings: [], suggestedLinks: [] });
  });

  it('calls Warden once the bible has enough content', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const aid = `bible-art-w-${i}`;
      dbRef.db!.prepare(`INSERT OR IGNORE INTO articles (id, world_id, category_id, title, status, template_type, current_version_id, created_at, updated_at)
        VALUES (?, 'world1', 'cat1', ?, 'draft', 'general', NULL, ?, ?)`).run(aid, aid, now, now);
      dbRef.db!.prepare(`INSERT INTO world_bible_entries (id, world_id, article_id, summary, sort_order, updated_at)
        VALUES (?, 'world1', ?, 'a summary', ?, ?)`).run(`entry-w-${i}`, aid, i, now);
    }
    vi.spyOn(WardenAgent.prototype, 'run').mockResolvedValue({
      output: { warnings: [{ severity: 'conflict', description: 'x' }], suggestedLinks: [] },
      tokensIn: 1,
      tokensOut: 1,
    });

    const state = baseState({ contextPackage: { targetTitle: 't', targetDescription: 'd' } as never });
    const result = await wardenNode(state);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('architectNode', () => {
  it('passes seedText/categories through to Architect and returns its stubs', async () => {
    const runSpy = vi.spyOn(ArchitectAgent.prototype, 'run').mockResolvedValue({
      output: { stubs: [{ title: 'A', categoryName: 'Lore', templateType: 'general', summary: 's' }] },
      tokensIn: 40,
      tokensOut: 30,
    });

    const state = baseState({ seedText: 'a fantasy world', categories: [{ id: 'cat1', name: 'Lore' }] });
    const result = await architectNode(state);

    expect(runSpy).toHaveBeenCalledWith('world1', expect.objectContaining({ seedText: 'a fantasy world' }));
    expect(result.stubs).toHaveLength(1);
  });
});
