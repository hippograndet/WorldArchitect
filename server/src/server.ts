import type { Server } from 'http';
import { closePgPool } from './db/pgPool.js';
import { createApp } from './app.js';
import { logger } from './observability/logger.js';
import { runStartupTasks } from './startup.js';

const DEFAULT_PORT = parsePort(process.env.PORT);

export async function startServer(port = DEFAULT_PORT): Promise<Server> {
  await runStartupTasks();

  const app = createApp();
  const server = app.listen(port, () => {
    logger.info('server.started', {
      url: `http://localhost:${port}`,
      sentryConfigured: !!process.env.SENTRY_DSN,
    });
  });
  registerGracefulShutdown(server);
  return server;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3001;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

function registerGracefulShutdown(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server.shutdown_started', { signal });

    const timeout = setTimeout(() => {
      logger.error('server.shutdown_timeout', { signal });
      process.exit(1);
    }, 10_000);
    timeout.unref();

    server.close((err) => {
      closePgPool()
        .then(() => {
          clearTimeout(timeout);
          if (err) {
            logger.error('server.shutdown_failed', { signal, error: err.message });
            process.exit(1);
          }
          logger.info('server.shutdown_complete', { signal });
          process.exit(0);
        })
        .catch((poolErr: unknown) => {
          clearTimeout(timeout);
          logger.error('server.shutdown_failed', {
            signal,
            error: poolErr instanceof Error ? poolErr.message : String(poolErr),
          });
          process.exit(1);
        });
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
