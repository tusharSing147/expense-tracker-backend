import app from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'server listening');
});

let shuttingDown = false;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown signal received');

  const force = setTimeout(() => {
    logger.error('forced shutdown after 10s');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(async () => {
    try {
      await prisma.$disconnect();
    } finally {
      logger.info('shutdown complete');
      process.exit(0);
    }
  });
  server.closeIdleConnections();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
