import { randomUUID } from 'node:crypto';
import type { AccountType } from '@prisma/client';
import { env } from '../../config/env';
import { redis } from '../../lib/redis';
import { generateOtp, hashOtp, safeCompare } from '../../lib/otp';

const OTP_KEY = (phone: string) => `otp:${phone}`;
const COOLDOWN_KEY = (phone: string) => `otp:cooldown:${phone}`;
const PHONE_COUNTER_KEY = (phone: string) => `otp:req:phone:${phone}`;
const IP_COUNTER_KEY = (ip: string) => `otp:req:ip:${ip}`;

export type StoredOtp = {
  otpRequestId: string;
  hash: string;
  attempts: number;
  createdAt: string;
  accountTypeHint: AccountType | null;
};

export const otpStore = {
  async read(phone: string): Promise<StoredOtp | null> {
    const raw = await redis.get(OTP_KEY(phone));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredOtp;
    } catch {
      return null;
    }
  },

  async write(phone: string, record: StoredOtp, ttlSeconds: number): Promise<void> {
    await redis.set(OTP_KEY(phone), JSON.stringify(record), 'EX', ttlSeconds);
  },

  async remove(phone: string): Promise<void> {
    await redis.del(OTP_KEY(phone), COOLDOWN_KEY(phone));
  },

  async cooldownRemainingSeconds(phone: string): Promise<number> {
    const ttl = await redis.pttl(COOLDOWN_KEY(phone));
    return ttl > 0 ? Math.ceil(ttl / 1000) : 0;
  },

  async startCooldown(phone: string, seconds: number): Promise<void> {
    if (seconds > 0) {
      await redis.set(COOLDOWN_KEY(phone), '1', 'EX', seconds);
    }
  },

  /** Fixed-window counter. Returns the count after incrementing. */
  async countRequest(key: string, windowSeconds: number): Promise<number> {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return count;
  },

  counterKeys: { phone: PHONE_COUNTER_KEY, ip: IP_COUNTER_KEY },
};

export type OtpDelivery = { otp: string; otpRequestId: string; expiresAt: Date };

/**
 * Creates (or replaces) the active OTP for a phone number.
 * In development and test environments the configured fixed OTP is used so the
 * frontend developer never needs an SMS; in production a random code is used.
 */
export async function createOtp(phone: string, accountTypeHint: AccountType | null): Promise<OtpDelivery> {
  const otp = env.otp.fixedOtpEnabled ? env.otp.devFixedOtp : generateOtp(env.otp.length);
  const otpRequestId = randomUUID();
  const now = new Date();

  await otpStore.write(
    phone,
    {
      otpRequestId,
      hash: hashOtp(phone, otp, env.otpHashSecret),
      attempts: 0,
      createdAt: now.toISOString(),
      accountTypeHint,
    },
    env.otp.ttlSeconds,
  );

  return {
    otp,
    otpRequestId,
    expiresAt: new Date(now.getTime() + env.otp.ttlSeconds * 1000),
  };
}

export async function checkOtp(
  phone: string,
  otp: string,
): Promise<{ status: 'ok' } | { status: 'invalid'; remainingAttempts: number } | { status: 'missing' } | { status: 'blocked' }> {
  const record = await otpStore.read(phone);
  if (!record) return { status: 'missing' };

  if (record.attempts >= env.otp.maxAttempts) {
    await otpStore.remove(phone);
    return { status: 'blocked' };
  }

  const expected = hashOtp(phone, otp, env.otpHashSecret);
  if (!safeCompare(expected, record.hash)) {
    const attempts = record.attempts + 1;
    const remainingAttempts = Math.max(0, env.otp.maxAttempts - attempts);
    if (remainingAttempts === 0) {
      await otpStore.remove(phone);
      return { status: 'blocked' };
    }
    const ttl = await redis.ttl(OTP_KEY(phone));
    await otpStore.write(phone, { ...record, attempts }, ttl > 0 ? ttl : env.otp.ttlSeconds);
    return { status: 'invalid', remainingAttempts };
  }

  return { status: 'ok' };
}
