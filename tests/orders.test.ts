import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { api, API, auth } from './helpers';
import { loginAsAdmin } from './catalog-helpers';
import { createShopFixture, loginAs } from './pricing-helpers';
import { addToCart, placeOrder, readyBuyer } from './order-helpers';

const stockOf = async (productId: string) =>
  (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;

describe('orders', () => {
  it('places an order, freezes the price, clears the cart and reduces stock', async () => {
    const { token, product, address } = await readyBuyer({ quantity: 2 });

    const response = await placeOrder(token, {
      addressId: address.id,
      deliveryDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      deliverySlot: '9 AM - 12 PM',
      notes: 'Call before arriving',
    });

    expect(response.status).toBe(201);
    const order = response.body.data;
    expect(order.status).toBe('CONFIRMED');
    expect(order.orderNumber).toMatch(/^SAR-\d{6}$/);
    expect(order.money).toMatchObject({
      itemTotalPaise: 13_700,
      minOrderChargePaise: 10_000,
      distanceChargePaise: 0,
      grandTotalPaise: 23_700,
    });
    expect(order.items[0]).toMatchObject({
      productId: product.id,
      quantity: 2,
      originalPricePaise: 6850,
      unitPricePaise: 6850,
      lineTotalPaise: 13_700,
    });
    expect(order.delivery).toMatchObject({
      pincode: '411005',
      slot: '9 AM - 12 PM',
      notes: 'Call before arriving',
    });
    expect(order.payment).toMatchObject({ method: 'CASH_ON_DELIVERY', status: 'PENDING' });
    expect(order.timeline).toHaveLength(1);
    expect(order.timeline[0].toStatus).toBe('CONFIRMED');

    // Stock went down and the cart is empty: the sale is committed in one go.
    expect(await stockOf(product.id)).toBe(998);
    expect(await prisma.cartItem.count()).toBe(0);
  });

  it('returns the same order when the same Idempotency-Key is sent twice', async () => {
    const { token, product } = await readyBuyer({ quantity: 2 });
    const key = 'checkout-double-tap-0001';

    const first = await placeOrder(token, {}, key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBe('false');

    const second = await placeOrder(token, {}, key);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);

    expect(await prisma.order.count()).toBe(1);
    // Only one order means stock was only taken once.
    expect(await stockOf(product.id)).toBe(998);
  });

  it('never sells the last item to two buyers', async () => {
    const fixture = await createShopFixture();
    await prisma.product.update({ where: { id: fixture.tmtProduct.id }, data: { stockQuantity: 1 } });

    const buyers = await Promise.all([
      loginAs('9876543210', AccountType.CUSTOMER),
      loginAs('9876543211', AccountType.CUSTOMER),
    ]);

    for (const [index, buyer] of buyers.entries()) {
      await prisma.address.create({
        data: {
          userId: buyer.user.id as string,
          contactName: 'Buyer',
          contactPhone: '9876543210',
          line1: `Plot ${index + 1}`,
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411005',
          latitude: 18.5308,
          longitude: 73.8478,
          isDefault: true,
        },
      });
      await addToCart(buyer.token, fixture.tmtProduct.id, 1);
    }

    const [first, second] = await Promise.all([
      placeOrder(buyers[0]!.token),
      placeOrder(buyers[1]!.token),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const failed = first.status === 409 ? first : second;
    expect(failed.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(failed.body.error.details.availableQuantity).toBe(0);
    expect(await stockOf(fixture.tmtProduct.id)).toBe(0);
    expect(await prisma.order.count()).toBe(1);
  });

  it('refuses an empty cart, a missing address, a past date and an unserviceable pincode', async () => {
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);

    const empty = await placeOrder(token);
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('CART_EMPTY');

    const fixture = await createShopFixture();
    await addToCart(token, fixture.tmtProduct.id, 1);

    const noAddress = await placeOrder(token);
    expect(noAddress.status).toBe(400);
    expect(noAddress.body.error.code).toBe('DELIVERY_ADDRESS_REQUIRED');

    await prisma.address.create({
      data: {
        userId: user.id as string,
        contactName: 'Buyer',
        contactPhone: '9876543210',
        line1: 'Plot 7',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411005',
        latitude: 18.5308,
        longitude: 73.8478,
        isDefault: true,
      },
    });

    const pastDate = await placeOrder(token, { deliveryDate: '2020-01-01' });
    expect(pastDate.status).toBe(400);
    expect(pastDate.body.error.code).toBe('VALIDATION_ERROR');

    await prisma.address.updateMany({
      where: { userId: user.id as string },
      data: { pincode: '400001', latitude: 19.076, longitude: 72.8777 },
    });
    const badPincode = await placeOrder(token);
    expect(badPincode.status).toBe(400);
    expect(badPincode.body.error.code).toBe('PINCODE_NOT_SERVICEABLE');
  });

  it('keeps the price of the sale after the catalogue changes', async () => {
    const { token, product } = await readyBuyer({ quantity: 2 });
    const placed = await placeOrder(token);
    expect(placed.status).toBe(201);

    await prisma.product.update({ where: { id: product.id }, data: { pricePaise: 9999 } });

    const stored = await api()
      .get(`${API}/orders/${placed.body.data.id}`)
      .set(auth(token));

    expect(stored.body.data.items[0].unitPricePaise).toBe(6850);
    expect(stored.body.data.money.itemTotalPaise).toBe(13_700);
  });

  it('lists the order history and hides other accounts orders', async () => {
    const { token } = await readyBuyer({ quantity: 1 });
    const order = await placeOrder(token);

    const mine = await api().get(`${API}/orders`).set(auth(token));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.meta.total).toBe(1);

    const other = await loginAs('9876543212', AccountType.CUSTOMER);
    const hidden = await api()
      .get(`${API}/orders/${order.body.data.id}`)
      .set(auth(other.token));
    expect(hidden.status).toBe(404);

    const anonymous = await api().get(`${API}/orders`);
    expect(anonymous.status).toBe(401);
  });

  it('cancels an order and puts the stock back', async () => {
    const { token, product } = await readyBuyer({ quantity: 3 });
    const placed = await placeOrder(token);
    const orderId = placed.body.data.id as string;
    expect(await stockOf(product.id)).toBe(997);

    const cancelled = await api()
      .post(`${API}/orders/${orderId}/cancel`)
      .set(auth(token))
      .send({ reason: 'Ordered the wrong size' });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.cancelReason).toBe('Ordered the wrong size');
    expect(await stockOf(product.id)).toBe(1000);

    const again = await api().post(`${API}/orders/${orderId}/cancel`).set(auth(token)).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ORDER_ALREADY_CANCELLED');

    // Stock is only restored once.
    expect(await stockOf(product.id)).toBe(1000);
  });

  it('moves an order forward only, and logs every status change', async () => {
    const { token } = await readyBuyer({ quantity: 1 });
    const placed = await placeOrder(token);
    const orderId = placed.body.data.id as string;
    const { token: adminToken } = await loginAsAdmin();

    const skipped = await api()
      .patch(`${API}/admin/orders/${orderId}/status`)
      .set(auth(adminToken))
      .send({ status: 'DELIVERED' });
    expect(skipped.status).toBe(409);
    expect(skipped.body.error.code).toBe('INVALID_ORDER_STATUS_CHANGE');

    const packed = await api()
      .patch(`${API}/admin/orders/${orderId}/status`)
      .set(auth(adminToken))
      .send({ status: 'PACKED', note: 'Ready for pickup' });
    expect(packed.body.data.status).toBe('PACKED');

    const out = await api()
      .patch(`${API}/admin/orders/${orderId}/status`)
      .set(auth(adminToken))
      .send({ status: 'OUT_FOR_DELIVERY' });
    expect(out.body.data.status).toBe('OUT_FOR_DELIVERY');

    const delivered = await api()
      .patch(`${API}/admin/orders/${orderId}/status`)
      .set(auth(adminToken))
      .send({ status: 'DELIVERED' });
    expect(delivered.body.data.status).toBe('DELIVERED');
    expect(delivered.body.data.timeline.map((entry: { toStatus: string }) => entry.toStatus)).toEqual([
      'CONFIRMED',
      'PACKED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);

    // A customer can never change a status.
    const forbidden = await api()
      .patch(`${API}/admin/orders/${orderId}/status`)
      .set(auth(token))
      .send({ status: 'PACKED' });
    expect(forbidden.status).toBe(403);
  });

  it('waives one charge on one order only', async () => {
    const { token, product } = await readyBuyer({ quantity: 1 });
    const first = await placeOrder(token);
    const { token: adminToken } = await loginAsAdmin();

    const waived = await api()
      .post(`${API}/admin/orders/${first.body.data.id}/waive-charge`)
      .set(auth(adminToken))
      .send({ charge: 'MIN_ORDER_CHARGE', note: 'Regular customer' });

    expect(waived.status).toBe(200);
    expect(waived.body.data.money).toMatchObject({
      minOrderChargePaise: 0,
      grandTotalPaise: 6850,
      waivedCharge: { code: 'MIN_ORDER_CHARGE', amountPaise: 10_000, note: 'Regular customer' },
    });

    const again = await api()
      .post(`${API}/admin/orders/${first.body.data.id}/waive-charge`)
      .set(auth(adminToken))
      .send({ charge: 'DISTANCE_CHARGE' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CHARGE_ALREADY_WAIVED');

    // A second order still carries the normal minimum order charge.
    await addToCart(token, product.id, 1);
    const second = await placeOrder(token);
    expect(second.body.data.money.minOrderChargePaise).toBe(10_000);
  });

  it('reorders an old order in one call', async () => {
    const { token, product } = await readyBuyer({ quantity: 2 });
    const placed = await placeOrder(token);

    const reordered = await api()
      .post(`${API}/orders/${placed.body.data.id}/reorder`)
      .set(auth(token));

    expect(reordered.status).toBe(200);
    expect(reordered.body.data.added).toBe(1);
    expect(reordered.body.data.skipped).toEqual([]);
    expect(reordered.body.data.cart.items[0]).toMatchObject({
      productId: product.id,
      quantity: 2,
    });

    // Reordering twice adds the quantities together.
    const twice = await api()
      .post(`${API}/orders/${placed.body.data.id}/reorder`)
      .set(auth(token));
    expect(twice.body.data.cart.items[0].quantity).toBe(4);
  });
});
