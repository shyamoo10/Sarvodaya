import { z } from 'zod';

export const verifyOnlinePaymentSchema = z.object({
  /** The Razorpay order id returned by POST /orders/{id}/payments/online. */
  razorpayOrderId: z.string().trim().min(1).max(80),
  razorpayPaymentId: z.string().trim().min(1).max(80),
  razorpaySignature: z.string().trim().min(1).max(200),
});

export type VerifyOnlinePaymentInput = z.infer<typeof verifyOnlinePaymentSchema>;
