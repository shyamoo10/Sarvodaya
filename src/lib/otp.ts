import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export function generateOtp(length = 6): string {
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

/** OTPs are never stored in plain text: only this keyed hash is persisted. */
export function hashOtp(phone: string, otp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${phone}:${otp}`).digest('hex');
}

export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
