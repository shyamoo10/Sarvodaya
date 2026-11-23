import { z } from 'zod';

export const deviceTokenSchema = z.object({
  token: z.string().trim().min(8).max(300),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).default('ANDROID'),
});

export const removeDeviceTokenSchema = z.object({
  token: z.string().trim().min(8).max(300),
});

export const notificationListQuerySchema = z.object({
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  channel: z.enum(['PUSH', 'SMS', 'WHATSAPP']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminNotificationListQuerySchema = notificationListQuerySchema.extend({
  event: z.enum(['ORDER_PLACED', 'ORDER_CONFIRMED', 'ORDER_DISPATCHED', 'ORDER_DELIVERED']).optional(),
  userId: z.string().uuid().optional(),
});

export const processQueueSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

export type DeviceTokenInput = z.infer<typeof deviceTokenSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type AdminNotificationListQuery = z.infer<typeof adminNotificationListQuerySchema>;
