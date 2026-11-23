import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { api, API, auth } from './helpers';
import { loginAsAdmin } from './catalog-helpers';
import { placeOrder, readyBuyer } from './order-helpers';

const KEY_SECRET = 'test-razorpay-key-secret';
const WEBHOOK_SECRET = 'test-razorpay-webhook-secret';

const hmac = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('hex');

/** Razorpay is stubbed: the suite must never talk to the real payment provider. */
function stubRazorpayOrder(amountPaise: number) {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        id: 'order_test_123',
        amount: amountPaise,
        currency: 'INR',
        status: 'created',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('payments', () => {
  it('marks cash on delivery as received, fully or in part', async () => {
    const { token } = await readyBuyer({ quantity: 2 });
    const placed = await placeOrder(token, { paymentMethod: 'CASH_ON_DELIVERY' });
    const orderId = placed.body.data.id as string;
    expect(placed.body.data.payment).toMatchObject({
      method: 'CASH_ON_DELIVERY',
      status: 'PENDING',
      amountDuePaise: 23_700,
    });

    const { token: adminToken } = await loginAsAdmin();

    const partial = await api()
      .post(`${API}/admin/orders/${orderId}/payments`)
      .set(auth(adminToken))
      .send({ amountPaise: 10_000, note: 'Part payment at the door' });
    expect(partial.status).toBe(201);
    expect(partial.body.data.payment).toMatchObject({
      status: 'PARTIALLY_PAID',
      amountPaidPaise: 10_000,
      amountDuePaise: 13_700,
    });

    const rest = await api()
      .post(`${API}/admin/orders/${orderId}/payments`)
      .set(auth(adminToken))
      .send({ amountPaise: 13_700 });
    expect(rest.body.data.payment).toMatchObject({ status: 'PAID', amountDuePaise: 0 });

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(stored.paymentStatus).toBe('PAID');
    expect(stored.amountPaidPaise).toBe(23_700);

    const extra = await api()
      .post(`${API}/admin/orders/${orderId}/payments`)
      .set(auth(adminToken))
      .send({ amountPaise: 1 });
    expect(extra.status).toBe(409);
    expect(extra.body.error.code).toBe('PAYMENT_ALREADY_SETTLED');
  });

  it('rejects a payment larger than the amount due', async () => {
    const { token } = await readyBuyer({ quantity: 1 });
    const placed = await placeOrder(token, { paymentMethod: 'CASH_ON_DELIVERY' });
    const { token: adminToken } = await loginAsAdmin();

    const tooMuch = await api()
      .post(`${API}/admin/orders/${placed.body.data.id}/payments`)
      .set(auth(adminToken))
      .send({ amountPaise: 999_999 });

    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('PAYMENT_AMOUNT_INVALID');
    expect(tooMuch.body.error.details.amountDuePaise).toBe(16_850);
  });

  it('starts an online payment and only counts it after the signature check', async () => {
    const { token } = await readyBuyer({ quantity: 2 });
    const placed = await placeOrder(token, { paymentMethod: 'ONLINE' });
    const orderId = placed.body.data.id as string;
    const fetchMock = stubRazorpayOrder(23_700);

    const intent = await api()
      .post(`${API}/orders/${orderId}/payments/online`)
      .set(auth(token));
    expect(intent.status).toBe(201);
    expect(intent.body.data).toMatchObject({
      keyId: 'rzp_test_sarvodaya',
      razorpayOrderId: 'order_test_123',
      amountPaise: 23_700,
      currency: 'INR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A forged signature changes nothing.
    const forged = await api()
      .post(`${API}/payments/razorpay/verify`)
      .set(auth(token))
      .send({
        razorpayOrderId: 'order_test_123',
        razorpayPaymentId: 'pay_test_1',
        razorpaySignature: 'deadbeef',
      });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');

    const stillPending = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(stillPending.paymentStatus).toBe('PENDING');

    const signature = hmac('order_test_123|pay_test_1', KEY_SECRET);
    const verified = await api()
      .post(`${API}/payments/razorpay/verify`)
      .set(auth(token))
      .send({
        razorpayOrderId: 'order_test_123',
        razorpayPaymentId: 'pay_test_1',
        razorpaySignature: signature,
      });

    expect(verified.status).toBe(200);
    expect(verified.body.data.alreadyVerified).toBe(false);
    expect(verified.body.data.order.payment).toMatchObject({
      status: 'PAID',
      amountPaidPaise: 23_700,
      amountDuePaise: 0,
    });

    const stored = await prisma.payment.findFirstOrThrow({ where: { providerOrderId: 'order_test_123' } });
    expect(stored.razorpaySignatureVerified).toBe(true);
    expect(stored.providerPaymentId).toBe('pay_test_1');

    // Repeating the verification is harmless.
    const again = await api()
      .post(`${API}/payments/razorpay/verify`)
      .set(auth(token))
      .send({
        razorpayOrderId: 'order_test_123',
        razorpayPaymentId: 'pay_test_1',
        razorpaySignature: signature,
      });
    expect(again.body.data.alreadyVerified).toBe(true);
  });

  it('confirms an online payment from a signed Razorpay webhook', async () => {
    const { token } = await readyBuyer({ quantity: 2 });
    const placed = await placeOrder(token, { paymentMethod: 'ONLINE' });
    const orderId = placed.body.data.id as string;
    stubRazorpayOrder(23_700);

    await api().post(`${API}/orders/${orderId}/payments/online`).set(auth(token));

    const rawBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_test_2', order_id: 'order_test_123', amount: 23_700, status: 'captured' },
        },
      },
    });

    const forged = await api()
      .post(`${API}/payments/razorpay/webhook`)
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', 'not-a-real-signature')
      .send(rawBody);
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');

    const accepted = await api()
      .post(`${API}/payments/razorpay/webhook`)
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', hmac(rawBody, WEBHOOK_SECRET))
      .send(rawBody);

    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({ received: true, matched: true, alreadyPaid: false });

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(stored.paymentStatus).toBe('PAID');

    // Razorpay retries webhooks: a duplicate delivery is a no-op.
    const duplicate = await api()
      .post(`${API}/payments/razorpay/webhook`)
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', hmac(rawBody, WEBHOOK_SECRET))
      .send(rawBody);
    expect(duplicate.body.data.alreadyPaid).toBe(true);

    const unknownBody = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_x', order_id: 'order_unknown' } } },
    });
    const unknown = await api()
      .post(`${API}/payments/razorpay/webhook`)
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', hmac(unknownBody, WEBHOOK_SECRET))
      .send(unknownBody);
    expect(unknown.body.data).toMatchObject({ received: true, matched: false });
  });

  it('refuses online payment for an order set to cash on delivery', async () => {
    const { token } = await readyBuyer({ quantity: 1 });
    const placed = await placeOrder(token, { paymentMethod: 'CASH_ON_DELIVERY' });

    const response = await api()
      .post(`${API}/orders/${placed.body.data.id}/payments/online`)
      .set(auth(token));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PAYMENT_NOT_ALLOWED');
  });
});
