import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD');

const optionalNote = z.string().trim().max(500, 'Notes cannot be longer than 500 characters');

/** Checkout: the cart is turned into an order exactly as it is stored on the server. */
export const checkoutSchema = z.object({
  /** Defaults to the address saved on the cart, then the default address. */
  addressId: z.string().uuid('Must be a valid address id').optional(),
  /** Requested delivery day. The shop confirms the exact timing. */
  deliveryDate: isoDate.optional(),
  deliverySlot: z.string().trim().min(1).max(60).optional(),
  notes: optionalNote.optional(),
  paymentMethod: z.enum(['ONLINE', 'CASH_ON_DELIVERY', 'CREDIT']).default('CASH_ON_DELIVERY'),
});

export const orderListQuerySchema = z.object({
  status: z
    .enum(['CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'])
    .optional(),
  paymentStatus: z.enum(['PENDING', 'PARTIALLY_PAID', 'PAID']).optional(),
  /** Inclusive ISO dates, e.g. 2026-01-01. */
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminOrderListQuerySchema = orderListQuerySchema.extend({
  userId: z.string().uuid('Must be a valid user id').optional(),
  /** Matches the order number, the customer's phone number or name. */
  search: z.string().trim().max(80).optional(),
  paymentMethod: z.enum(['ONLINE', 'CASH_ON_DELIVERY', 'CREDIT']).optional(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
  note: z.string().trim().max(300).optional(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const waiveChargeSchema = z.object({
  charge: z.enum(['MIN_ORDER_CHARGE', 'DISTANCE_CHARGE']),
  note: z.string().trim().max(200).optional(),
});

export const recordPaymentSchema = z.object({
  amountPaise: z.coerce
    .number()
    .int('Amount must be whole paise')
    .min(1, 'Amount must be at least 1 paisa'),
  note: z.string().trim().max(200).optional(),
});

export const reorderSchema = z
  .object({
    /** Optional: cap each line at this quantity when adding it back. */
    maxQuantity: z.number().int().min(1).max(999).optional(),
  })
  .optional();

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type WaiveChargeInput = z.infer<typeof waiveChargeSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
