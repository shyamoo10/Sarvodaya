import 'dotenv/config';
import { z } from 'zod';

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  OTP_HASH_SECRET: z.string().min(32, 'OTP_HASH_SECRET must be at least 32 characters long'),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
  OTP_REQUESTS_PER_WINDOW: z.coerce.number().int().positive().default(5),
  OTP_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
  OTP_REQUESTS_PER_IP_PER_WINDOW: z.coerce.number().int().positive().default(30),

  DEV_FIXED_OTP: z
    .string()
    .regex(/^\d{4,8}$/, 'DEV_FIXED_OTP must be numeric')
    .default('123456'),
  DEV_FIXED_OTP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // Razorpay. Optional: without keys the online payment endpoints answer
  // PAYMENT_NOT_CONFIGURED, while Cash on Delivery and credit orders still work.
  RAZORPAY_KEY_ID: z.string().trim().optional(),
  RAZORPAY_KEY_SECRET: z.string().trim().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().trim().optional(),
  RAZORPAY_BASE_URL: z.string().url().default('https://api.razorpay.com'),
});

const parsed = rawEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Fail fast: a misconfigured API must not boot with weak or missing secrets.
  throw new Error(`Invalid environment configuration:\n${problems}`);
}

const raw = parsed.data;

/**
 * The fixed development OTP is a convenience for local work and tests only.
 * It is hard-disabled in production no matter what the environment says.
 */
export function isFixedOtpEnabled(input: {
  nodeEnv: string;
  enabled: boolean;
}): boolean {
  return input.nodeEnv !== 'production' && input.enabled;
}

export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Unsupported duration "${value}". Use a value such as 900, 30m, 12h or 30d.`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400;
  return amount * multiplier;
}

const corsOrigins = raw.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  databaseUrl: raw.DATABASE_URL,
  redisUrl: raw.REDIS_URL,
  jwtSecret: raw.JWT_SECRET,
  jwtExpiresIn: raw.JWT_EXPIRES_IN,
  jwtExpiresInSeconds: parseDurationToSeconds(raw.JWT_EXPIRES_IN),
  otpHashSecret: raw.OTP_HASH_SECRET,
  corsOrigins,
  otp: {
    ttlSeconds: raw.OTP_TTL_SECONDS,
    length: raw.OTP_LENGTH,
    maxAttempts: raw.OTP_MAX_ATTEMPTS,
    resendCooldownSeconds: raw.OTP_RESEND_COOLDOWN_SECONDS,
    requestsPerWindow: raw.OTP_REQUESTS_PER_WINDOW,
    windowSeconds: raw.OTP_WINDOW_SECONDS,
    requestsPerIpPerWindow: raw.OTP_REQUESTS_PER_IP_PER_WINDOW,
    devFixedOtp: raw.DEV_FIXED_OTP,
    fixedOtpEnabled: isFixedOtpEnabled({
      nodeEnv: raw.NODE_ENV,
      enabled: raw.DEV_FIXED_OTP_ENABLED,
    }),
  },
  razorpay: {
    keyId: raw.RAZORPAY_KEY_ID ?? '',
    keySecret: raw.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: raw.RAZORPAY_WEBHOOK_SECRET ?? '',
    baseUrl: raw.RAZORPAY_BASE_URL,
    // Online payment needs a key pair; the webhook secret is optional but
    // recommended, and without it the webhook endpoint stays closed.
    isConfigured: Boolean(raw.RAZORPAY_KEY_ID && raw.RAZORPAY_KEY_SECRET),
    isWebhookConfigured: Boolean(raw.RAZORPAY_WEBHOOK_SECRET),
  },
} as const;

export type Env = typeof env;
