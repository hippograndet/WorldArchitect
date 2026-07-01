import { logger } from './logger.js';

export function captureException(err: unknown, context: Record<string, unknown> = {}): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  logger.error('sentry.capture_exception', {
    dsnConfigured: true,
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    context,
  });
}
