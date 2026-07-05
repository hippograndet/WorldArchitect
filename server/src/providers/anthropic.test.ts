import { vi, describe, it, expect, beforeEach } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { AnthropicProvider } from './anthropic.js';
import type { ChatMessage } from './types.js';

const messages: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful test agent.' },
  { role: 'user', content: 'Do the thing.' },
];

function baseResponse(usage: Partial<{ input_tokens: number; output_tokens: number; cache_creation_input_tokens: number | null; cache_read_input_tokens: number | null }>) {
  return {
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      ...usage,
    },
  };
}

beforeEach(() => {
  createMock.mockReset();
});

describe('AnthropicProvider system-prompt caching', () => {
  it('sends the system message as a cacheable content block', async () => {
    createMock.mockResolvedValueOnce(baseResponse({ input_tokens: 100, output_tokens: 10 }));

    const provider = new AnthropicProvider('test-key');
    await provider.complete(messages);

    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.system).toEqual([
      { type: 'text', text: 'You are a helpful test agent.', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('folds cache_creation/cache_read tokens into tokensIn instead of dropping them', async () => {
    createMock.mockResolvedValueOnce(baseResponse({
      input_tokens: 20,
      output_tokens: 10,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 0,
    }));

    const provider = new AnthropicProvider('test-key');
    const result = await provider.complete(messages);

    expect(result.tokensIn).toBe(520);
    expect(result.tokensOut).toBe(10);
  });

  it('folds cache_read tokens into tokensIn on a cache hit', async () => {
    createMock.mockResolvedValueOnce(baseResponse({
      input_tokens: 20,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 480,
    }));

    const provider = new AnthropicProvider('test-key');
    const result = await provider.complete(messages);

    expect(result.tokensIn).toBe(500);
  });
});
