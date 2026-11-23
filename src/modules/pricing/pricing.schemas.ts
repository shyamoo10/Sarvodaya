import { z } from 'zod';

const uuid = z.string().uuid('Must be a valid id');
const paise = z.number().int('Must be a whole number of paise').min(0).max(100_000_000);
const basisPoints = z
  .number()
  .int('Must be a whole number of basis points')
  .min(1, 'Discount must be at least 0.01%')
  .max(10_000, 'Discount cannot exceed 100%');

/** Shop settings: the admin can change every amount without a code change. */
export const updateShopSettingsSchema = z
  .object({
    shopLatitude: z.number().min(-90).max(90),
    shopLongitude: z.number().min(-180).max(180),
    minOrderAmountPaise: paise,
    minOrderChargePaise: paise,
    freeDeliveryAbovePaise: paise.nullable(),
    freeDeliveryRadiusKm: z.number().min(0).max(200).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one setting to change',
  });

export const contractorPriceCreateSchema = z.object({
  contractorId: uuid,
  productId: uuid,
  pricePaise: paise.refine((value) => value > 0, 'Price must be more than zero'),
  isActive: z.boolean().default(true),
});

export const contractorPriceUpdateSchema = z
  .object({
    pricePaise: paise.refine((value) => value > 0, 'Price must be more than zero'),
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to change',
  });

export const contractorPriceQuerySchema = z.object({
  contractorId: uuid.optional(),
  productId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const bulkDiscountCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    productId: uuid.nullable().optional(),
    categoryId: uuid.nullable().optional(),
    minQuantity: z.number().int().min(1).max(1_000_000),
    discountBps: basisPoints,
    isActive: z.boolean().default(true),
  })
  .refine((value) => !(value.productId && value.categoryId), {
    message: 'Scope a discount to one product, one category, or the whole shop - not both',
    path: ['categoryId'],
  });

export const bulkDiscountUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    productId: uuid.nullable(),
    categoryId: uuid.nullable(),
    minQuantity: z.number().int().min(1).max(1_000_000),
    discountBps: basisPoints,
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to change',
  });

export const contractorRuleCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  categoryId: uuid.nullable().optional(),
  discountBps: basisPoints,
  isActive: z.boolean().default(true),
});

export const contractorRuleUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    categoryId: uuid.nullable(),
    discountBps: basisPoints,
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to change',
  });

export const pricingRuleQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type UpdateShopSettingsInput = z.infer<typeof updateShopSettingsSchema>;
export type ContractorPriceCreateInput = z.infer<typeof contractorPriceCreateSchema>;
export type ContractorPriceUpdateInput = z.infer<typeof contractorPriceUpdateSchema>;
export type ContractorPriceQuery = z.infer<typeof contractorPriceQuerySchema>;
export type BulkDiscountCreateInput = z.infer<typeof bulkDiscountCreateSchema>;
export type BulkDiscountUpdateInput = z.infer<typeof bulkDiscountUpdateSchema>;
export type ContractorRuleCreateInput = z.infer<typeof contractorRuleCreateSchema>;
export type ContractorRuleUpdateInput = z.infer<typeof contractorRuleUpdateSchema>;
export type PricingRuleQuery = z.infer<typeof pricingRuleQuerySchema>;
