import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { serializeOrder } from '../orders/order.serializer';
import { getOrderForUser } from '../orders/orders.service';
import { verifyOnlinePaymentSchema, type VerifyOnlinePaymentInput } from './payment.schemas';
import { handleRazorpayWebhook, verifyOnlinePayment } from './payments.service';

export const paymentsRouter = Router();

/**
 * Razorpay webhook. Public by design: Razorpay signs the body, and only a valid
 * signature with the configured webhook secret is accepted.
 */
paymentsRouter.post(
  '/razorpay/webhook',
  asyncHandler(async (req, res) => {
    const rawBody =
      (req as typeof req & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const result = await handleRazorpayWebhook(rawBody, req.header('x-razorpay-signature'));
    sendSuccess(res, result, 200);
  }),
);

/** Verifies the checkout response from the app. Never trusted without the HMAC. */
paymentsRouter.post(
  '/razorpay/verify',
  requireAuth,
  validate(verifyOnlinePaymentSchema),
  asyncHandler(async (req, res) => {
    const result = await verifyOnlinePayment(
      req.authUser!,
      req.body as VerifyOnlinePaymentInput,
    );
    const order = await getOrderForUser(req.authUser!, result.orderId);
    sendSuccess(
      res,
      { order: serializeOrder(order), alreadyVerified: result.alreadyVerified },
      200,
    );
  }),
);
