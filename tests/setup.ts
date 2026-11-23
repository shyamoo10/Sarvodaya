import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach } from 'vitest';

// These defaults exist so `npm test` works on a fresh machine and in CI.
// Real secrets are never committed: CI sets its own throwaway values.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??=
  'postgresql://sarvodaya:sarvodaya@localhost:5432/sarvodaya_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-long-enough-1234';
process.env.JWT_EXPIRES_IN ??= '30d';
process.env.OTP_HASH_SECRET ??= 'test-otp-hash-secret-that-is-long-enough';
process.env.CORS_ORIGINS ??= 'http://localhost:5173';
process.env.DEV_FIXED_OTP ??= '123456';
process.env.DEV_FIXED_OTP_ENABLED ??= 'true';
process.env.LOG_LEVEL ??= 'silent';

if (!existsSync(path.resolve(process.cwd(), 'docs/openapi.yaml'))) {
  throw new Error('docs/openapi.yaml is missing: the API serves it at /docs.');
}

beforeEach(async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { redis } = await import('../src/lib/redis');
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Address", "ProjectSite", "User" RESTART IDENTITY CASCADE',
  );
  await redis.flushdb();
});

afterAll(async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { redis } = await import('../src/lib/redis');
  await prisma.$disconnect();
  redis.disconnect();
});
