import { z } from 'zod';

export const UNIT_VALUES = ['kg', 'bag', 'piece', 'litre', 'box'] as const;
export type PublicUnit = (typeof UNIT_VALUES)[number];

/** Units are stored uppercase in Postgres but exposed lowercase in the API. */
export const unitSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value): value is PublicUnit => (UNIT_VALUES as readonly string[]).includes(value), {
    message: `unit must be one of: ${UNIT_VALUES.join(', ')}`,
  });

export const categorySlugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

/** Empty strings from forms are normalised to null so they clear the field. */
export const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value === '' ? null : value));

const skuSchema = z
  .string()
  .trim()
  .min(1, 'SKU is required')
  .max(40)
  .transform((value) => value.toUpperCase());

const photoSchema = z.string().trim().url('Photo must be a valid URL');

export const createProductSchema = z.object({
  sku: skuSchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(160),
  description: optionalText(1000),
  brand: z.string().trim().min(1, 'Brand is required').max(80),
  sizeVariant: optionalText(80),
  unit: unitSchema,
  pricePaise: z
    .number()
    .int('pricePaise must be an integer (paise)')
    .positive('pricePaise must be greater than zero')
    .max(100_000_000, 'pricePaise is too large'),
  stockQuantity: z.number().int().min(0).max(1_000_000).default(0),
  photos: z.array(photoSchema).max(10, 'At most 10 photos are allowed').default([]),
  categoryId: z.string().uuid('categoryId must be a valid id'),
  isActive: z.boolean().default(true),
});

/** SKU is immutable: it identifies the product in bulk imports. */
export const updateProductSchema = createProductSchema.omit({ sku: true }).partial();

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

export const productQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().min(1).max(90).optional(),
    brand: z.string().trim().min(1).max(80).optional(),
    minPricePaise: z.coerce.number().int().min(0).optional(),
    maxPricePaise: z.coerce.number().int().min(0).optional(),
    inStock: booleanQuery.optional(),
    sort: z.enum(['newest', 'price_asc', 'price_desc', 'name_asc']).optional(),
    page: z.string().regex(/^\d+$/, 'page must be a number').optional(),
    limit: z.string().regex(/^\d+$/, 'limit must be a number').optional(),
  })
  .refine(
    (value) =>
      value.minPricePaise === undefined ||
      value.maxPricePaise === undefined ||
      value.minPricePaise <= value.maxPricePaise,
    {
      message: 'minPricePaise cannot be greater than maxPricePaise',
      path: ['minPricePaise'],
    },
  );

export const adminProductQuerySchema = productQuerySchema.and(
  z.object({
    isActive: booleanQuery.optional(),
  }),
);

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(categorySlugRegex, 'slug may only contain lowercase letters, numbers and dashes')
    .max(90)
    .optional(),
  description: optionalText(300),
  parentId: z.string().uuid('parentId must be a valid id').nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(categorySlugRegex, 'slug may only contain lowercase letters, numbers and dashes')
    .max(90)
    .optional(),
  description: optionalText(300),
  parentId: z.string().uuid('parentId must be a valid id').nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export const stockUpdateSchema = z
  .object({
    /** Absolute new stock. */
    stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
    /** Relative change, for example -2 after a sale or +50 after a delivery. */
    adjustment: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  })
  .refine((value) => (value.stockQuantity === undefined) !== (value.adjustment === undefined), {
    message: 'Provide exactly one of stockQuantity or adjustment',
    path: ['stockQuantity'],
  });

export type ProductQuery = z.infer<typeof productQuerySchema>;
export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type StockUpdateInput = z.infer<typeof stockUpdateSchema>;
