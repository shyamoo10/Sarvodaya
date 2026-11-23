import { Router } from 'express';
import { asyncHandler, sendNoContent, sendSuccess } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import {
  deviceTokenSchema,
  notificationListQuerySchema,
  removeDeviceTokenSchema,
  type DeviceTokenInput,
  type NotificationListQuery,
} from './notification.schemas';
import { listNotificationsForUser, serializeNotification } from './notification.service';

/** The signed-in account's own message history and push registration. */
export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  validate(notificationListQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as NotificationListQuery;
    const result = await listNotificationsForUser(req.authUser!.id, query);

    sendSuccess(res, result.items.map(serializeNotification), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

/** Registers (or refreshes) a push token for this device. */
notificationsRouter.post(
  '/device-tokens',
  validate(deviceTokenSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as DeviceTokenInput;
    const token = await prisma.deviceToken.upsert({
      where: { token: input.token },
      update: {
        userId: req.authUser!.id,
        platform: input.platform,
        isActive: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId: req.authUser!.id,
        token: input.token,
        platform: input.platform,
      },
    });

    sendSuccess(
      res,
      {
        id: token.id,
        platform: token.platform,
        isActive: token.isActive,
        lastSeenAt: token.lastSeenAt.toISOString(),
      },
      201,
    );
  }),
);

notificationsRouter.delete(
  '/device-tokens',
  validate(removeDeviceTokenSchema),
  asyncHandler(async (req, res) => {
    await prisma.deviceToken.updateMany({
      where: { token: (req.body as { token: string }).token, userId: req.authUser!.id },
      data: { isActive: false },
    });
    sendNoContent(res);
  }),
);
