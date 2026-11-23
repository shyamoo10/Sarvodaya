import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { auditLogQuerySchema, type AuditLogQuery } from './audit.schemas';
import { listAuditLogs, serializeAuditLog } from './audit.service';

export const adminAuditRouter = Router();

adminAuditRouter.use(requireAuth, requireAdmin);

/** Who changed what, newest first, filterable by actor, record and action. */
adminAuditRouter.get(
  '/',
  validate(auditLogQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as AuditLogQuery;
    const result = await listAuditLogs(query);

    sendSuccess(res, result.items.map(serializeAuditLog), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);
