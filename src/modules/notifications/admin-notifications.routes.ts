import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../users/user.schemas';
import {
  adminNotificationListQuerySchema,
  processQueueSchema,
  type AdminNotificationListQuery,
} from './notification.schemas';
import {
  listNotifications,
  processDueNotifications,
  retryNotification,
  serializeNotification,
} from './notification.service';

export const adminNotificationsRouter = Router();

adminNotificationsRouter.use(requireAuth, requireAdmin);

adminNotificationsRouter.get(
  '/',
  validate(adminNotificationListQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as AdminNotificationListQuery;
    const result = await listNotifications(query);

    sendSuccess(res, result.items.map(serializeNotification), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

/** Sends whatever is due right now instead of waiting for the next worker poll. */
adminNotificationsRouter.post(
  '/process',
  validate(processQueueSchema),
  asyncHandler(async (req, res) => {
    const { limit } = req.body as { limit: number };
    sendSuccess(res, await processDueNotifications({ limit }), 200);
  }),
);

adminNotificationsRouter.post(
  '/:id/retry',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const notification = await retryNotification(req.params.id as string);
    sendSuccess(res, serializeNotification(notification), 200);
  }),
);
