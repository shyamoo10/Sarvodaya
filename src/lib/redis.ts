import Redis from 'ioredis';
import { env } from '../config/env';

export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('error', (error) => {
  // The API logs and keeps serving non-OTP traffic; OTP endpoints will error.
  // eslint-disable-next-line no-console
  console.error('[redis] connection error:', error.message);
});
