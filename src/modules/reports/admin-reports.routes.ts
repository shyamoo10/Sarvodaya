import { Router } from 'express';
import type { Response } from 'express';
import { asyncHandler } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { reportQuerySchema, type ReportQuery } from './report.schemas';
import { buildOrdersReport, buildSalesReport } from './report.service';

export const adminReportsRouter = Router();

adminReportsRouter.use(requireAuth, requireAdmin);

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendWorkbook(res: Response, workbook: { buffer: Buffer; fileName: string }): Response {
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="${workbook.fileName}"`);
  res.setHeader('Content-Length', String(workbook.buffer.length));
  return res.status(200).send(workbook.buffer);
}

/** Sales for a period, one row per order plus a summary sheet. */
adminReportsRouter.get(
  '/sales.xlsx',
  validate(reportQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    sendWorkbook(res, await buildSalesReport(req.query as unknown as ReportQuery));
  }),
);

/** Every item sold in a period, one row per line. */
adminReportsRouter.get(
  '/orders.xlsx',
  validate(reportQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    sendWorkbook(res, await buildOrdersReport(req.query as unknown as ReportQuery));
  }),
);
