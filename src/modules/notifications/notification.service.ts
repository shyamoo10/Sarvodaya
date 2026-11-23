import { Prisma, type NotificationEvent } from '@prisma/client';
import { env } from '../../config/env';
import { ErrorCode } from '../../config/error-codes';
import { ApiError, parsePagination } from '../../lib/http';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { deliverNotification, type NotificationChannelName } from './notification.providers';
import type {
  AdminNotificationListQuery,
  NotificationListQuery,
} from './notification.schemas';

/** Rupees for a customer-facing message: 134000 -> "₹1,340.00". */
export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const EVENT_MESSAGES: Record<
  NotificationEvent,
  (input: { orderNumber: string; grandTotalPaise: number; slot: string | null }) => {
    title: string;
    body: string;
  }
> = {
  ORDER_PLACED: ({ orderNumber, grandTotalPaise }) => ({
    title: 'Order placed',
    body: `Your order ${orderNumber} for ${formatPaise(grandTotalPaise)} has been placed. We will confirm it shortly.`,
  }),
  ORDER_CONFIRMED: ({ orderNumber }) => ({
    title: 'Order confirmed',
    body: `Good news — order ${orderNumber} is confirmed and is being packed.`,
  }),
  ORDER_DISPATCHED: ({ orderNumber, slot }) => ({
    title: 'Out for delivery',
    body: `Order ${orderNumber} has left the shop and is on its way to you${slot ? ` (${slot})` : ''}.`,
  }),
  ORDER_DELIVERED: ({ orderNumber }) => ({
    title: 'Order delivered',
    body: `Order ${orderNumber} has been delivered. Thank you for shopping with ${env.invoice.shopName}.`,
  }),
};

/** Which order status change produces which customer message. */
export const STATUS_EVENT: Record<string, NotificationEvent> = {
  PACKED: 'ORDER_CONFIRMED',
  OUT_FOR_DELIVERY: 'ORDER_DISPATCHED',
  DELIVERED: 'ORDER_DELIVERED',
};

type OrderForNotification = {
  id: string;
  orderNumber: string;
  userId: string;
  grandTotalPaise: number;
  deliverySlot: string | null;
  user: { phone: string; name: string };
};

/**
 * Queues the customer messages for one order event.
 *
 * Rows are written for every configured channel and the background worker sends
 * them, so a slow or broken provider never delays checkout or a status change.
 * The unique `dedupeKey` makes this idempotent: the same event is never queued
 * twice for one order and channel.
 */
export async function queueOrderNotifications(
  orderId: string,
  event: NotificationEvent,
): Promise<number> {
  if (!env.notifications.enabled) {
    return 0;
  }

  const order: OrderForNotification | null = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      grandTotalPaise: true,
      deliverySlot: true,
      user: { select: { phone: true, name: true } },
    },
  });
  if (!order) return 0;

  const message = EVENT_MESSAGES[event]({
    orderNumber: order.orderNumber,
    grandTotalPaise: order.grandTotalPaise,
    slot: order.deliverySlot,
  });

  // Push is only useful when the account has a device to receive it.
  const hasPush =
    (await prisma.deviceToken.count({ where: { userId: order.userId, isActive: true } })) > 0;

  let queued = 0;
  for (const channel of env.notifications.channels) {
    if (channel === 'PUSH' && !hasPush) continue;

    try {
      await prisma.notification.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          event,
          channel,
          title: message.title,
          body: message.body,
          maxAttempts: env.notifications.maxAttempts,
          dedupeKey: `${order.id}:${event}:${channel}`,
        },
      });
      queued += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        continue; // Already queued for this order and channel.
      }
      // A notification must never fail the order it belongs to.
      logger.error({ err: error, orderId, event }, 'Could not queue a notification');
    }
  }

  return queued;
}

export type ClaimedNotification = {
  id: string;
  userId: string;
  channel: NotificationChannelName;
  title: string;
  body: string;
  attempts: number;
  maxAttempts: number;
};

/**
 * Claims due notifications with `FOR UPDATE SKIP LOCKED`, so several API instances
 * can run the worker at the same time without sending anything twice.
 */
async function claimDueNotifications(limit: number, leaseSeconds: number): Promise<ClaimedNotification[]> {
  return prisma.$queryRaw<ClaimedNotification[]>`
    UPDATE "Notification"
       SET "attempts" = "attempts" + 1,
           "nextAttemptAt" = NOW() + (${leaseSeconds} * INTERVAL '1 second'),
           "updatedAt" = NOW()
     WHERE "id" IN (
       SELECT "id"
         FROM "Notification"
        WHERE "status" = 'PENDING'
          AND "attempts" < "maxAttempts"
          AND "nextAttemptAt" <= NOW()
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING "id", "userId", "channel", "title", "body", "attempts", "maxAttempts"
  `;
}

/**
 * Sends every notification that is due, retrying with an exponential backoff.
 * A row fails for good only after `maxAttempts`, and the reason is kept on it.
 */
export async function processDueNotifications(
  options: { limit?: number; leaseSeconds?: number } = {},
): Promise<{ sent: number; retrying: number; failed: number }> {
  const limit = options.limit ?? 25;
  const leaseSeconds = options.leaseSeconds ?? 120;
  const due = await claimDueNotifications(limit, leaseSeconds);

  let sent = 0;
  let retrying = 0;
  let failed = 0;

  for (const notification of due) {
    try {
      const [user, tokens] = await Promise.all([
        prisma.user.findUnique({
          where: { id: notification.userId },
          select: { phone: true, isBlocked: true },
        }),
        prisma.deviceToken.findMany({
          where: { userId: notification.userId, isActive: true },
          select: { token: true },
        }),
      ]);

      if (!user) {
        throw new Error('The account no longer exists');
      }

      const result = await deliverNotification({
        channel: notification.channel,
        title: notification.title,
        body: notification.body,
        target: { phone: user.phone, deviceTokens: tokens.map((token) => token.token) },
      });

      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.providerMessageId,
          lastError: null,
        },
      });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown delivery error';
      const isLastAttempt = notification.attempts >= notification.maxAttempts;

      if (isLastAttempt) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'FAILED', lastError: message.slice(0, 500) },
        });
        failed += 1;
        logger.error(
          { notificationId: notification.id, channel: notification.channel, err: message },
          'Notification failed for good',
        );
      } else {
        const delaySeconds =
          env.notifications.retryBaseSeconds * 2 ** Math.max(0, notification.attempts - 1);
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'PENDING',
            lastError: message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + Math.min(delaySeconds, 3600) * 1000),
          },
        });
        retrying += 1;
      }
    }
  }

  return { sent, retrying, failed };
}

export async function listNotificationsForUser(userId: string, query: NotificationListQuery) {
  const { page, limit, skip } = parsePagination(query);
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return { items, total, page, limit };
}

export async function listNotifications(query: AdminNotificationListQuery) {
  const { page, limit, skip } = parsePagination(query);
  const where: Prisma.NotificationWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
    ...(query.event ? { event: query.event } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      include: { user: { select: { id: true, name: true, phone: true } } },
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return { items, total, page, limit };
}

/** Puts a failed notification back in the queue, for the admin screen. */
export async function retryNotification(id: string) {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Notification not found');
  }
  if (notification.status !== 'FAILED') {
    throw new ApiError(
      409,
      ErrorCode.NOTIFICATION_NOT_RETRYABLE,
      'Only a failed notification can be retried',
    );
  }

  return prisma.notification.update({
    where: { id },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
    },
  });
}

export function serializeNotification(notification: {
  id: string;
  userId: string;
  orderId: string | null;
  event: NotificationEvent;
  channel: string;
  status: string;
  title: string;
  body: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  user?: { id: string; name: string; phone: string };
}) {
  return {
    id: notification.id,
    userId: notification.userId,
    orderId: notification.orderId,
    event: notification.event,
    channel: notification.channel,
    status: notification.status,
    title: notification.title,
    body: notification.body,
    attempts: notification.attempts,
    maxAttempts: notification.maxAttempts,
    lastError: notification.lastError,
    sentAt: notification.sentAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    ...(notification.user ? { user: notification.user } : {}),
  };
}
