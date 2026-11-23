import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { api, API, auth } from './helpers';
import { loginAsAdmin } from './catalog-helpers';
import { placeOrder, readyBuyer } from './order-helpers';

describe('admin dashboard', () => {
  it('shows today orders, pending deliveries, low stock and COD outstanding', async () => {
    const buyer = await readyBuyer({ quantity: 2 });
    const placed = await placeOrder(buyer.token, { paymentMethod: 'CASH_ON_DELIVERY' });
    expect(placed.status).toBe(201);

    // A second product that is nearly out of stock.
    const lowStock = await prisma.product.create({
      data: {
        sku: 'PLB-JQ-ANG',
        name: 'Jaquar Angle Valve',
        brand: 'Jaquar',
        unit: 'PIECE',
        pricePaise: 62_000,
        stockQuantity: 2,
        categoryId: buyer.steel.id,
      },
    });
    // A healthy product that must not be listed.
    await prisma.product.update({
      where: { id: buyer.cementBag.id },
      data: { stockQuantity: 400 },
    });

    const { token: adminToken } = await loginAsAdmin();
    const response = await api().get(`${API}/admin/dashboard`).set(auth(adminToken));

    expect(response.status).toBe(200);
    const data = response.body.data;

    expect(data.today.orders).toBe(1);
    expect(data.today.salesPaise).toBe(23_700);
    expect(data.today.byStatus.CONFIRMED).toBe(1);

    expect(data.pendingDeliveries.count).toBe(1);
    expect(data.pendingDeliveries.orders[0]).toMatchObject({
      orderNumber: placed.body.data.orderNumber,
      status: 'CONFIRMED',
      pincode: '411005',
      grandTotalPaise: 23_700,
    });

    expect(data.lowStock.count).toBe(1);
    expect(data.lowStock.products[0]).toMatchObject({
      id: lowStock.id,
      sku: 'PLB-JQ-ANG',
      stockQuantity: 2,
    });

    expect(data.cashOnDelivery).toEqual({ orders: 1, outstandingPaise: 23_700 });
  });

  it('respects the threshold and drops an order once it is delivered', async () => {
    const buyer = await readyBuyer({ quantity: 1 });
    const placed = await placeOrder(buyer.token);
    const { token: adminToken } = await loginAsAdmin();

    const strict = await api()
      .get(`${API}/admin/dashboard?lowStockThreshold=999`)
      .set(auth(adminToken));
    expect(strict.body.data.lowStock.count).toBe(2);
    expect(strict.body.data.lowStock.threshold).toBe(999);

    for (const status of ['PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      await api()
        .patch(`${API}/admin/orders/${placed.body.data.id}/status`)
        .set(auth(adminToken))
        .send({ status });
    }

    const after = await api().get(`${API}/admin/dashboard`).set(auth(adminToken));
    expect(after.body.data.pendingDeliveries.count).toBe(0);
    expect(after.body.data.today.orders).toBe(1);
  });

  it('is admin only', async () => {
    const { token } = await readyBuyer({ quantity: 1 });
    const response = await api().get(`${API}/admin/dashboard`).set(auth(token));
    expect(response.status).toBe(403);

    const anonymous = await api().get(`${API}/admin/dashboard`);
    expect(anonymous.status).toBe(401);
  });
});
