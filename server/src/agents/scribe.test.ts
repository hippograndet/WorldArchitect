import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CompletionResult } from '../providers/types.js';
import type { ContextPackage } from '../services/archivist.js';
import type { WorldContext } from './director.js';

const completeMock = vi.hoisted(() => vi.fn<() => Promise<CompletionResult>>());

vi.mock('../providers/index.js', () => ({
  getProvider: async () => ({ name: 'groq', complete: completeMock, estimateTokens: async () => 0 }),
}));

vi.mock('../services/callLogger.js', () => ({
  logCall: vi.fn(),
}));

vi.mock('../services/llmTraceService.js', () => ({
  logLlmTrace: vi.fn(),
}));

vi.mock('../tools/context.js', () => ({
  CONTEXT_TOOLS: [],
  SEARCH_ARTICLES_TOOL: { name: 'search_articles', description: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  LOOKUP_NAMES_TOOL: { name: 'lookup_names', description: 'names', inputSchema: { type: 'object', properties: {} } },
  executeContextTool: async () => 'Context tool result',
}));

import { ScribeAgent } from './scribe.js';
import { MentionExtractorAgent } from './mentionExtractor.js';

const contextPackage: ContextPackage = {
  targetId: 'article-1',
  targetTitle: 'Arros',
  targetTemplateType: 'general',
  targetIntroduction: 'A storm-touched world.',
  targetDescription: '',
  targetChronology: '',
  parents: [],
  siblings: [],
  children: [],
  fixedPoints: [],
  temporalNeighbors: [],
  referencedArticles: [],
  estimatedTokens: 100,
};

const worldContext: WorldContext = {
  worldId: 'world-1',
  name: 'Arros',
  tone: 'narrative',
  originPoint: null,
  styleConfig: null,
};

function textResult(content: string): CompletionResult {
  return { content, tokensIn: 10, tokensOut: 5, stopReason: 'end_turn' };
}

function toolUseResult(name: string, input: Record<string, unknown>): CompletionResult {
  return {
    content: '',
    tokensIn: 10,
    tokensOut: 5,
    stopReason: 'tool_use',
    toolCalls: [{ id: `call-${name}`, name, input }],
  };
}

beforeEach(() => {
  completeMock.mockReset();
});

describe('ScribeAgent free-text output', () => {
  it('parses assistant prose as an expand_description draft', async () => {
    completeMock.mockResolvedValueOnce(textResult('A clean description paragraph.'));

    const result = await new ScribeAgent().run('world-1', {
      worldContext,
      mode: 'expand_description',
      articleTitle: contextPackage.targetTitle,
      templateType: contextPackage.targetTemplateType,
      currentIntroduction: contextPackage.targetIntroduction,
      selectedProposal: { title: 'Stormlands', direction: 'Develop the storm-touched wilderness.' },
    });

    expect(result.output).toEqual({ mode: 'single', description: 'A clean description paragraph.' });
    expect(completeMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.not.objectContaining({ toolChoice: 'required' }),
      expect.arrayContaining([expect.objectContaining({ name: 'lookup_names' })]),
    );
  });

  it('rejects empty prose', async () => {
    completeMock.mockResolvedValueOnce(textResult('   '));

    await expect(new ScribeAgent().run('world-1', {
      worldContext,
      mode: 'expand_description',
      articleTitle: contextPackage.targetTitle,
      templateType: contextPackage.targetTemplateType,
    })).rejects.toThrow('Scribe returned an empty description');
  });

  it('rejects prose that includes the Description heading', async () => {
    completeMock.mockResolvedValueOnce(textResult('## Description\n\nA headed draft.'));

    await expect(new ScribeAgent().run('world-1', {
      worldContext,
      mode: 'reorganize',
      articleTitle: contextPackage.targetTitle,
      templateType: contextPackage.targetTemplateType,
    })).rejects.toThrow('Description heading');
  });

  it('can use a context tool before returning prose', async () => {
    completeMock
      .mockResolvedValueOnce(toolUseResult('lookup_names', {}))
      .mockResolvedValueOnce(textResult('A description after checking context.'));

    const result = await new ScribeAgent().run('world-1', {
      worldContext,
      mode: 'expand_description',
      articleTitle: contextPackage.targetTitle,
      templateType: contextPackage.targetTemplateType,
    });

    expect(result.output).toMatchObject({ description: 'A description after checking context.' });
    expect(completeMock).toHaveBeenCalledTimes(2);
  });
});

describe('MentionExtractorAgent', () => {
  it('returns compact structured mentions', async () => {
    completeMock.mockResolvedValueOnce(toolUseResult('submit_mentions', {
      mentions: [{ title: 'The Glass Ford', templateType: 'location', summary: 'A river crossing made sacred by stormglass.' }],
    }));

    const result = await new MentionExtractorAgent().run('world-1', {
      contextPackage,
      description: 'The Glass Ford shines beneath stormlight.',
    });

    expect(result.output.mentions).toEqual([
      { title: 'The Glass Ford', templateType: 'location', summary: 'A river crossing made sacred by stormglass.' },
    ]);
  });

  it('rejects invalid mention payloads', async () => {
    completeMock.mockResolvedValueOnce(toolUseResult('submit_mentions', {
      mentions: [{ title: '', templateType: 'location' }],
    }));

    await expect(new MentionExtractorAgent().run('world-1', {
      contextPackage,
      description: 'Invalid mention test.',
    })).rejects.toThrow();
  });
});
