import type { ChatMessage, CompletionOptions } from './types.js';

export class ProviderSafetyError extends Error {
  constructor(
    public readonly code: 'LLM_TIMEOUT' | 'LLM_RETRY_EXHAUSTED' | 'LLM_BUDGET_EXCEEDED' | 'LOCAL_ONLY_EGRESS_BLOCKED',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderSafetyError';
  }
}

export function estimateMessages(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + Math.ceil(message.content.length / 4), 0);
}

export function assertTokenBudget(messages: ChatMessage[], options?: CompletionOptions): void {
  const envLimit = Number(process.env.WORLDARCHITECT_MAX_REQUEST_TOKENS ?? 0) || undefined;
  const maxTotalTokens = options?.maxTotalTokens ?? envLimit;
  if (!maxTotalTokens) return;

  const requested = estimateMessages(messages) + (options?.maxTokens ?? 4096);
  if (requested > maxTotalTokens) {
    throw new ProviderSafetyError(
      'LLM_BUDGET_EXCEEDED',
      `LLM request exceeds token ceiling (${requested}/${maxTotalTokens}). Reduce context depth or output length.`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProviderSafetyError('LLM_TIMEOUT', `LLM request timed out after ${timeoutMs}ms.`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runProviderRequest<T>(
  fn: () => Promise<T>,
  options?: CompletionOptions,
): Promise<T> {
  const attempts = Math.max(1, options?.retry?.attempts ?? Number(process.env.WORLDARCHITECT_LLM_RETRY_ATTEMPTS ?? 2));
  const baseDelayMs = Math.max(0, options?.retry?.baseDelayMs ?? 250);
  const timeoutMs = Math.max(1, options?.timeoutMs ?? Number(process.env.WORLDARCHITECT_LLM_TIMEOUT_MS ?? 60000));
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (err instanceof ProviderSafetyError && err.code === 'LLM_TIMEOUT') throw err;
      if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : 'Provider request failed.';
  throw new ProviderSafetyError('LLM_RETRY_EXHAUSTED', `LLM provider failed after ${attempts} attempts: ${message}`);
}
