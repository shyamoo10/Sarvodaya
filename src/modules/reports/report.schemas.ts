import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD');

export const reportRangeSchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .refine(
    (value) => {
      if (!value.from || !value.to) return true;
      return new Date(value.from).getTime() <= new Date(value.to).getTime();
    },
    { message: '`from` must be on or before `to`', path: ['from'] },
  );

export const orderReportQuerySchema = reportRangeSchema.and(
  z.object({
    status: z
      .enum(['PLACED', 'CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'])
      .optional(),
  }),
);

export type ReportRangeQuery = z.infer<typeof reportRangeSchema>;
export type OrderReportQuery = z.infer<typeof orderReportQuerySchema>;
