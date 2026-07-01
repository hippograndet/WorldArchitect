const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /sk-proj-[A-Za-z0-9_-]{16,}/g,
  /sk-[A-Za-z0-9_-]{24,}/g,
  /gsk_[A-Za-z0-9_-]{16,}/g,
];

export function maskSecret(value: string | undefined): string | undefined {
  if (!value || value.length < 8) return undefined;
  return `${value.slice(0, 6)}****${value.slice(-4)}`;
}

export function redactSecrets(input: unknown): unknown {
  if (typeof input === 'string') {
    return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED_SECRET]'), input);
  }

  if (Array.isArray(input)) return input.map(redactSecrets);

  if (input && typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (/key|token|secret|authorization|password/i.test(key)) {
        result[key] = typeof value === 'string' ? maskSecret(value) ?? '[REDACTED_SECRET]' : '[REDACTED_SECRET]';
      } else {
        result[key] = redactSecrets(value);
      }
    }
    return result;
  }

  return input;
}

export function redactErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  const message = err instanceof Error ? err.message : fallback;
  return redactSecrets(message) as string;
}
