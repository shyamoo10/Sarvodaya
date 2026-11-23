import type { RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { logger } from '../../lib/logger';
import { recordAudit } from './audit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_SUMMARY = 300;

function summarizeBody(body: unknown): Prisma.InputJsonValue | null {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return null;
  try {
    const json = JSON.stringify(body);
    // Keep the row small; the audit log is a trail, not a data store.
    return JSON.parse(json.slice(0, 2000)) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

/**
 * Which record family a path belongs to, for the audit log.
 * /admin/products/... records entityType PRODUCT, and so on.
 */
const ENTITY_TYPES: Record<string, string> = {
  products: 'PRODUCT',
  categories: 'CATEGORY',
  orders: 'ORDER',
  pricing: 'PRICING',
  delivery: 'DELIVERY',
  'credit-terms': 'CREDIT_TERMS',
  users: 'USER',
  customers: 'CUSTOMER',
  contractors: 'CONTRACTOR',
  notifications: 'NOTIFICATION',
  dashboard: 'DASHBOARD',
  'audit-logs': 'AUDIT',
  reports: 'REPORT',
};

export function deriveEntityType(path: string): string {
  const segment = path.split('?')[0]!.split('/').filter(Boolean)[3] ?? '';
  return ENTITY_TYPES[segment] ?? 'ADMIN';
}

/**
 * Records every successful admin write in the audit log.
 *
 * Mounted once for the whole /admin surface, after the auth guards. It only
 * listens: a failure to write the audit row is logged and never breaks the change
 * the admin made.
 */
export function auditAdmin(entityType?: string): RequestHandler {
  return (req, res, next) => {
    if (!MUTATING.has(req.method)) {
      next();
      return;
    }

    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.authUser) return;

      const routePath = req.route?.path ?? req.path;
      const fullPath = `${req.baseUrl.replace('/api/v1', '')}${routePath === '/' ? '' : routePath}`;
      const action = `${req.method} ${fullPath}`.slice(0, 60);
      const summary = `${req.authUser.accountType} ${req.authUser.phone} ${action}`.slice(0, MAX_SUMMARY);

      void recordAudit({
        actorId: req.authUser.id,
        action,
        entityType: entityType ?? deriveEntityType(req.originalUrl),
        entityId: (req.params.id as string | undefined) ?? (req.params.pincode as string | undefined) ?? null,
        summary,
        metadata: summarizeBody(req.body),
        ipAddress: req.ip ?? null,
        requestId: req.requestId ?? null,
      }).catch((error: unknown) => {
        logger.error({ err: error, action }, 'Could not write the audit log');
      });
    });

    next();
  };
}
