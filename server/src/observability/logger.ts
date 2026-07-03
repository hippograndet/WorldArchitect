import { redactSecrets } from '../security/redaction.js';
import { contextStorage } from '../requestContext.js';

type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const ctx = contextStorage.getStore();
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.userId ? { userId: ctx.userId } : {}),
    ...redactSecrets(fields) as Record<string, unknown>,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
};
