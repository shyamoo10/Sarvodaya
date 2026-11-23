import { z } from 'zod';

export const dashboardQuerySchema = z.object({
  /** Products at or below this stock level are listed as running low. */
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).default(10),
  pendingLimit: z.coerce.number().int().min(1).max(50).default(10),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
