import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  orderReportQuerySchema,
  reportRangeSchema,
  type OrderReportQuery,
  type ReportRangeQuery,
} from './report.schemas';
import { buildOrderReport, buildSalesReport } from './report.service';

export const adminReportsRouter = Router();

adminReportsRouter.use(requireAuth, requireAdmin);

function sendWorkbook(
  res: Parameters<Parameters<typeof asyncHandler>[0]>[1],
  buffer: Buffer,
  fileName: string,
): void {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.status(200).send(buffer);
}

/** GET /admin/reports/sales.xlsx — one row per order line. */
adminReportsRouter.get(
  '/sales.xlsx',
  validate(reportRangeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as ReportRangeQuery;
    const report = await buildSalesReport(query);
    sendWorkbook(res, report.buffer, report.fileName);
  }),
);

/** GET /admin/reports/orders.xlsx — one row per order. */
adminReportsRouter.get(
  '/orders.xlsx',
  validate(orderReportQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as OrderReportQuery;
    const report = await buildOrderReport(query);
    sendWorkbook(res, report.buffer, report.fileName);
  }),
);
