import { z } from 'zod';

export const directoryQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  isBlocked: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
