import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { ErrorCode } from '../config/error-codes';
import { ApiError } from './http';
import { logger } from './logger';

/**
 * Razorpay helpers.
 *
 * The client is never trusted: a payment only counts after the server checks the
 * HMAC signature of the checkout response or of the webhook body, both computed
 * with secrets that never leave the server.
 */

export function hmacSha256Hex(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time comparison, so a wrong signature leaks nothing through timing. */
export function signaturesMatch(expectedHex: string, receivedHex: string | undefined): boolean {
  if (!receivedHex) return false;
  const expected = Buffer.from(expectedHex, 'utf8');
  const received = Buffer.from(receivedHex.trim(), 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Signature of the checkout handler: HMAC_SHA256("<razorpay_order_id>|<razorpay_payment_id>",
 * key secret).
 */
export function verifyCheckoutSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  if (!env.razorpay.keySecret) return false;
  const expected = hmacSha256Hex(
    `${input.razorpayOrderId}|${input.razorpayPaymentId}`,
    env.razorpay.keySecret,
  );
  return signaturesMatch(expected, input.signature);
}

/** Signature of a webhook: HMAC_SHA256 of the exact raw body, with the webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!env.razorpay.webhookSecret) return false;
  return signaturesMatch(hmacSha256Hex(rawBody, env.razorpay.webhookSecret), signature);
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt?: string | null;
  status?: string;
};

/**
 * Creates a Razorpay order for the amount due. The secret is only ever sent to
 * Razorpay itself; the app receives the public key id from the caller.
 */
export async function createRazorpayOrder(input: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!env.razorpay.isConfigured) {
    throw new ApiError(
      503,
      ErrorCode.PAYMENT_NOT_CONFIGURED,
      'Online payment is not set up yet. Please choose cash on delivery or contact the shop.',
    );
  }

  const auth = Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${env.razorpay.baseUrl}/v1/orders`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        notes: input.notes ?? {},
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.error({ status: response.status, body: text.slice(0, 500) }, 'Razorpay order failed');
      throw new ApiError(
        502,
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        'We could not start the online payment. Please try again or choose cash on delivery.',
      );
    }

    return (await response.json()) as RazorpayOrder;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error({ err: error }, 'Razorpay request failed');
    throw new ApiError(
      502,
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      'We could not reach the payment provider. Please try again.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
