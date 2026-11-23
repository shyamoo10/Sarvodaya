import type { AccountType } from '@prisma/client';
import { env } from '../../config/env';
import { ErrorCode } from '../../config/error-codes';
import { ApiError } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { createRazorpayOrder, verifyCheckoutSignature, verifyWebhookSignature } from '../../lib/razorpay';
import { syncOrderPayments } from '../orders/order.actions.service';
import type { VerifyOnlinePaymentInput } from './payment.schemas';

type PaymentUser = { id: string; accountType: AccountType };

export type OnlinePaymentIntent = {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  orderNumber: string;
};

/**
 * Starts (or restarts) an online payment for an ONLINE order. The app receives the
 * public key id and the Razorpay order id only; the secret stays on the server.
 */
export async function startOnlinePayment(
  user: PaymentUser,
  orderId: string,
): Promise<OnlinePaymentIntent> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
  });
  if (!order) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }
  if (order.status === 'CANCELLED') {
    throw new ApiError(409, ErrorCode.ORDER_NOT_PAYABLE, 'This order was cancelled');
  }
  if (order.paymentMethod !== 'ONLINE') {
    throw new ApiError(
      400,
      ErrorCode.PAYMENT_NOT_ALLOWED,
      order.paymentMethod === 'CREDIT'
        ? 'This order is set to pay later by credit terms'
        : 'This order is set to cash on delivery',
    );
  }

  const amountDuePaise = order.grandTotalPaise - order.amountPaidPaise;
  if (amountDuePaise <= 0) {
    throw new ApiError(409, ErrorCode.PAYMENT_ALREADY_SETTLED, 'This order is already fully paid');
  }
  if (!env.razorpay.isConfigured) {
    throw new ApiError(
      503,
      ErrorCode.PAYMENT_NOT_CONFIGURED,
      'Online payment is not set up yet. Please choose cash on delivery or contact the shop.',
    );
  }

  const pending = await prisma.payment.findFirst({
    where: {
      orderId: order.id,
      provider: 'RAZORPAY',
      status: 'PENDING',
      providerOrderId: { not: null },
      amountPaise: amountDuePaise,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (pending?.providerOrderId) {
    return {
      keyId: env.razorpay.keyId,
      razorpayOrderId: pending.providerOrderId,
      amountPaise: pending.amountPaise,
      currency: order.currency,
      orderNumber: order.orderNumber,
    };
  }

  const providerOrder = await createRazorpayOrder({
    amountPaise: amountDuePaise,
    receipt: order.orderNumber,
    notes: { orderId: order.id, orderNumber: order.orderNumber },
  });

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: 'RAZORPAY',
      status: 'PENDING',
      amountPaise: amountDuePaise,
      providerOrderId: providerOrder.id,
    },
  });

  return {
    keyId: env.razorpay.keyId,
    razorpayOrderId: providerOrder.id,
    amountPaise: amountDuePaise,
    currency: order.currency,
    orderNumber: order.orderNumber,
  };
}

/**
 * Checks the checkout response from Razorpay. Only a valid HMAC signature can make
 * a payment count; the client's word alone never does.
 */
export async function verifyOnlinePayment(
  user: PaymentUser,
  input: VerifyOnlinePaymentInput,
): Promise<{ orderId: string; alreadyVerified: boolean }> {
  const payment = await prisma.payment.findFirst({
    where: { providerOrderId: input.razorpayOrderId, provider: 'RAZORPAY' },
    include: { order: { select: { id: true, userId: true, status: true } } },
  });

  if (!payment || (user.accountType !== 'ADMIN' && payment.order.userId !== user.id)) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Payment not found for this order');
  }
  if (payment.status === 'SUCCEEDED') {
    return { orderId: payment.order.id, alreadyVerified: true };
  }
  if (payment.order.status === 'CANCELLED') {
    throw new ApiError(409, ErrorCode.ORDER_NOT_PAYABLE, 'This order was cancelled');
  }
  if (!env.razorpay.keySecret) {
    throw new ApiError(503, ErrorCode.PAYMENT_NOT_CONFIGURED, 'Online payment is not set up yet');
  }

  const valid = verifyCheckoutSignature({
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    signature: input.razorpaySignature,
  });
  if (!valid) {
    throw new ApiError(
      400,
      ErrorCode.PAYMENT_SIGNATURE_INVALID,
      'We could not verify this payment. If money was deducted, it will be confirmed automatically.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        providerPaymentId: input.razorpayPaymentId,
        razorpaySignatureVerified: true,
        receivedAt: new Date(),
      },
    });
    await syncOrderPayments(tx, payment.order.id);
  });

  return { orderId: payment.order.id, alreadyVerified: false };
}

type RazorpayWebhookBody = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } };
    order?: { entity?: { id?: string; amount?: number; status?: string } };
  };
};

/**
 * Razorpay webhook. The body is signed, so a forged call cannot mark an order paid.
 * Duplicate deliveries are harmless: the payment is only updated once.
 */
export async function handleRazorpayWebhook(
  rawBody: string,
  signature: string | undefined,
): Promise<{ received: true; matched: boolean; alreadyPaid: boolean }> {
  if (!env.razorpay.isWebhookConfigured) {
    throw new ApiError(503, ErrorCode.PAYMENT_NOT_CONFIGURED, 'The payment webhook is not set up');
  }
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new ApiError(400, ErrorCode.PAYMENT_SIGNATURE_INVALID, 'Invalid webhook signature');
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Webhook body is not valid JSON');
  }

  const paymentEntity = body.payload?.payment?.entity;
  const providerOrderId = paymentEntity?.order_id ?? body.payload?.order?.entity?.id;
  const providerPaymentId = paymentEntity?.id;

  if (!providerOrderId) {
    return { received: true, matched: false, alreadyPaid: false };
  }

  const payment = await prisma.payment.findFirst({
    where: { providerOrderId, provider: 'RAZORPAY' },
    include: { order: { select: { id: true, status: true } } },
  });
  if (!payment) {
    logger.warn({ providerOrderId }, 'Razorpay webhook for an unknown payment');
    return { received: true, matched: false, alreadyPaid: false };
  }

  if (payment.status === 'SUCCEEDED') {
    return { received: true, matched: true, alreadyPaid: true };
  }
  if (payment.order.status === 'CANCELLED') {
    logger.warn({ orderId: payment.order.id }, 'Razorpay payment for a cancelled order');
    return { received: true, matched: true, alreadyPaid: false };
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        providerPaymentId: providerPaymentId ?? null,
        razorpaySignatureVerified: true,
        receivedAt: new Date(),
      },
    });
    await syncOrderPayments(tx, payment.order.id);
  });

  return { received: true, matched: true, alreadyPaid: false };
}
