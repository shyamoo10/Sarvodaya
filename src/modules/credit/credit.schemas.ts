import { z } from 'zod';

export const creditTermsCreateSchema = z.object({
  contractorId: z.string().uuid('Must be a valid contractor id'),
  isEnabled: z.boolean().default(true),
  /** Null means no hard limit; the shop still sees the outstanding balance. */
  creditLimitPaise: z.number().int().min(0).nullable().optional(),
  paymentTermDays: z.number().int().min(1).max(365).default(30),
  notes: z.string().trim().max(300).optional(),
});

export const creditTermsUpdateSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    creditLimitPaise: z.number().int().min(0).nullable().optional(),
    paymentTermDays: z.number().int().min(1).max(365).optional(),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to change',
  });

export const creditTermsQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  isEnabled: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreditTermsCreateInput = z.infer<typeof creditTermsCreateSchema>;
export type CreditTermsUpdateInput = z.infer<typeof creditTermsUpdateSchema>;
export type CreditTermsQuery = z.infer<typeof creditTermsQuerySchema>;
