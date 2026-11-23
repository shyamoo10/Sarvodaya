import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { api, API, auth } from './helpers';
import { loginAsAdmin } from './catalog-helpers';
import { processDueNotifications } from '../src/modules/notifications/notification.service';
import { placeOrder, readyBuyer } from './order-helpers';

describe('order notifications', () => {
  it('queues a message when the order is placed and the worker sends it', async () => {
    const { token, user } = await readyBuyer({ quantity: 2 });
    const placed = await placeOrder(token);
    expect(placed.status).toBe(201);

    const queued = await prisma.notification.findMany({ where: { orderId: placed.body.data.id } });
    // No device token registered, so only the SMS channel is queued.
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      userId: user.id,
      event: 'ORDER_PLACED',
      channel: 'SMS',
      status: 'PENDING',
      attempts: 0,
      title: 'Order placed',
    });
    expect(queued[0]!.body).toContain(placed.body.data.orderNumber);
    expect(queued[0]!.body).toContain('₹237.00');

    const run = await processDueNotifications({ limit: 10 });
    expect(run.sent).toBe(1);
    expect(run.failed).toBe(0);

    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: queued[0]!.id } });
    expect(stored.status).toBe('SENT');
    expect(stored.attempts).toBe(1);
    expect(stored.sentAt).not.toBeNull();
    expect(stored.providerMessageId).toMatch(/^stub-sms-/);

    // Nothing is due the second time.
    const second = await processDueNotifications({ limit: 10 });
    expect(second).toEqual({ sent: 0, retrying: 0, failed: 0 });
  });

  it('notifies on packing, dispatch and delivery exactly once per event', async () => {
    const { token } = await readyBuyer({ quantity: 1 });
    const placed = await placeOrder(token);
    const orderId = placed.body.data.id as string;
    const { token: adminToken } = await loginAsAdmin();

    for (const status of ['PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      const response = await api()
        .patch(`${API}/admin/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({ status });
      expect(response.status).toBe(200);
    }

    const events = await prisma.notification.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: { event: true, channel: true },
    });

    expect(events.map((row) => row.event)).toEqual([
      'ORDER_PLACED',
      'ORDER_CONFIRMED',
      'ORDER_DISPATCHED',
      'ORDER_DELIVERED',
    ]);
    expect(events.every((row) => row.channel === 'SMS')).toBe(true);

    const run = await processDueNotifications({ limit: 20 });
    expect(run.sent).toBe(4);
  });

  it('registers a device and then sends the push too', async () => {
    const { token } = await readyBuyer({ quantity: 1 });

    const registered = await api()
      .post(`${API}/me/notifications/device-tokens`)
      .set(auth(token))
      .send({ token: 'device-token-android-123456', platform: 'ANDROID' });
    expect(registered.status).toBe(201);
    expect(registered.body.data).toMatchObject({ platform: 'ANDROID', isActive: true });

    const placed = await placeOrder(token);
    const queued = await prisma.notification.findMany({
      where: { orderId: placed.body.data.id },
      select: { channel: true },
    });
    expect(queued.map((row) => row.channel).sort()).toEqual(['PUSH', 'SMS']);

    const run = await processDueNotifications({ limit: 10 });
    expect(run.sent).toBe(2);

    // The customer can read their own message history.
    const history = await api().get(`${API}/me/notifications`).set(auth(token));
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(2);
    expect(history.body.data[0]).toMatchObject({ event: 'ORDER_PLACED' });
  });

  it('retries a failed send and lets the admin put it back in the queue', async () => {
    const { token, user } = await readyBuyer({ quantity: 1 });
    const placed = await placeOrder(token);

    // A push with no device left cannot be delivered: it retries, then fails.
    const push = await prisma.notification.create({
      data: {
        userId: user.id as string,
        orderId: placed.body.data.id as string,
        event: 'ORDER_CONFIRMED',
        channel: 'PUSH',
        title: 'Order confirmed',
        body: 'Testing a failed push',
        maxAttempts: 1,
      },
    });

    const firstRun = await processDueNotifications({ limit: 10 });
    expect(firstRun.failed).toBe(1);

    const failed = await prisma.notification.findUniqueOrThrow({ where: { id: push.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toContain('push token');

    const { token: adminToken } = await loginAsAdmin();

    const listed = await api()
      .get(`${API}/admin/notifications?status=FAILED`)
      .set(auth(adminToken));
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((row: { id: string }) => row.id === push.id)).toBe(true);

    const retried = await api()
      .post(`${API}/admin/notifications/${push.id}/retry`)
      .set(auth(adminToken));
    expect(retried.status).toBe(200);
    expect(retried.body.data).toMatchObject({ status: 'PENDING', attempts: 0 });

    const again = await api()
      .post(`${API}/admin/notifications/${push.id}/retry`)
      .set(auth(adminToken));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOTIFICATION_NOT_RETRYABLE');
  });

  it('keeps the queue admin-only and processes on demand', async () => {
    const { token } = await readyBuyer({ quantity: 1 });
    await placeOrder(token);

    const forbidden = await api().get(`${API}/admin/notifications`).set(auth(token));
    expect(forbidden.status).toBe(403);

    const { token: adminToken } = await loginAsAdmin();
    const processed = await api()
      .post(`${API}/admin/notifications/process`)
      .set(auth(adminToken))
      .send({ limit: 5 });
    expect(processed.status).toBe(200);
    expect(processed.body.data.sent).toBe(1);
  });
});
