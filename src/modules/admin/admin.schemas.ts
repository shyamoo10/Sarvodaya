import { AccountType } from '@prisma/client';
import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  accountType: z.nativeEnum(AccountType).optional(),
  isBlocked: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export const blockUserSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});
