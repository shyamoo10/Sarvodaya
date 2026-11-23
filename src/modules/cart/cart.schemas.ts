import { z } from 'zod';

const quantity = z
  .number()
  .int('Quantity must be a whole number')
  .min(1, 'Quantity must be at least 1')
  .max(999, 'Quantity cannot be more than 999');

export const addCartItemSchema = z.object({
  productId: z.string().uuid('Must be a valid product id'),
  quantity: quantity.default(1),
});

export const updateCartItemSchema = z.object({ quantity });

export const cartQuerySchema = z.object({
  /** Optional: price the cart for this address instead of the saved one. */
  addressId: z.string().uuid('Must be a valid address id').optional(),
});

export const setDeliveryAddressSchema = z.object({
  addressId: z.string().uuid('Must be a valid address id').nullable(),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type CartQuery = z.infer<typeof cartQuerySchema>;
export type SetDeliveryAddressInput = z.infer<typeof setDeliveryAddressSchema>;
