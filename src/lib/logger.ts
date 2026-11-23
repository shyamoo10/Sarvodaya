import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.logLevel,
  redact: {
    paths: ['req.headers.authorization', 'password', 'otp'],
    censor: '[redacted]',
  },
  base: { service: 'sarvodaya-api' },
});
