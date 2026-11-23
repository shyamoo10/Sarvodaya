import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';

async function main(): Promise<void> {
  const app = createApp();

  const server = app.listen(env.port, '0.0.0.0', () => {
    logger.info(
      { port: env.port, env: env.nodeEnv, docs: `http://localhost:${env.port}/docs` },
      'Sarvodaya API listening',
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await prisma.$disconnect().catch(() => undefined);
      redis.disconnect();
      process.exit(0);
    });
    // Do not hang forever on open connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((error) => {
  logger.error({ err: error }, 'Failed to start API');
  process.exit(1);
});
