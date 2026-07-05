import { vi, describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Tool } from '../tools/types.js';
import type { ChatMessage, CompletionResult } from '../providers/types.js';

const completeMock = vi.hoisted(() => vi.fn<() => Promise<CompletionResult>>());
const logCallMock = vi.hoisted(() => vi.fn());

vi.mock('../providers/index.js', () => ({
  getProvider: async () => ({ name: 'anthropic', complete: completeMock, estimateTokens: async () => 0 }),
}));

vi.mock('../services/callLogger.js', () => ({
  logCall: logCallMock,
}));

vi.mock('../tools/context.js', () => ({
  CONTEXT_TOOLS: [],
  executeContextTool: async () => 'ok',
}));

// Import AFTER the mocks are registered.
import { BaseAgent } from './base.js';

const OutputSchema = z.object({ value: z.string() });

/** Minimal concrete agent for exercising the tool-use loop directly — one
 * context tool (get_thing) plus the mandatory output tool, so a test can
 * force a multi-turn loop by having the mocked provider call get_thing before
 * finally calling the output tool. */
class TestAgent extends BaseAgent<Record<string, never>, { value: string }> {
  readonly agentType = 'test_agent';
  readonly outputToolName = 'submit_test';
  readonly mode = 'write' as const;

  protected buildMessages(): ChatMessage[] {
    return [{ role: 'system', content: 'test' }, { role: 'user', content: 'go' }];
  }

  protected getContextTools(): Tool[] {
    return [{ name: 'get_thing', description: 'test tool', inputSchema: { type: 'object', properties: {} } }];
  }

  protected buildOutputTool(): Tool {
    return { name: 'submit_test', description: 'submit', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } };
  }

  protected parseOutput(input: Record<string, unknown>): { value: string } {
    return OutputSchema.parse(input);
  }
}

function toolUseResult(toolName: string, input: Record<string, unknown>): CompletionResult {
  return {
    content: '',
    tokensIn: 5,
    tokensOut: 2,
    stopReason: 'tool_use',
    toolCalls: [{ id: `call-${toolName}`, name: toolName, input }],
  };
}

beforeEach(() => {
  completeMock.mockReset();
  logCallMock.mockReset();
});

describe('BaseAgent.run() iteration counting', () => {
  it('logs iterations=1 for a single-turn call (output tool called immediately)', async () => {
    completeMock.mockResolvedValueOnce(toolUseResult('submit_test', { value: 'ok' }));

    const agent = new TestAgent();
    const result = await agent.run('world1', {});

    expect(result.output).toEqual({ value: 'ok' });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(logCallMock).toHaveBeenCalledWith(expect.objectContaining({
      iterations: 1,
      pipelineRunId: undefined,
      pipelineType: undefined,
      status: 'success',
    }));
  });

  it('logs the real iteration count when the model calls a context tool before the output tool', async () => {
    completeMock
      .mockResolvedValueOnce(toolUseResult('get_thing', {}))
      .mockResolvedValueOnce(toolUseResult('get_thing', {}))
      .mockResolvedValueOnce(toolUseResult('submit_test', { value: 'ok' }));

    const agent = new TestAgent();
    const result = await agent.run('world1', {}, { pipelineRunId: 'run-abc', pipelineType: 'test_pipeline' });

    expect(result.output).toEqual({ value: 'ok' });
    expect(completeMock).toHaveBeenCalledTimes(3);
    expect(logCallMock).toHaveBeenCalledWith(expect.objectContaining({
      iterations: 3,
      pipelineRunId: 'run-abc',
      pipelineType: 'test_pipeline',
      status: 'success',
    }));
  });
});
