import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { api, API, auth } from './helpers';
import { loginAsAdmin } from './catalog-helpers';
import { createShopFixture, loginAs } from './pricing-helpers';
import { placeOrder, readyBuyer } from './order-helpers';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** supertest treats an unknown binary type as text unless we collect the bytes. */
function binaryGet(url: string, token: string) {
  return api()
    .get(url)
    .set(auth(token))
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

async function waitForAudit(token: string, contains: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await api().get(`${API}/admin/audit-logs?limit=50`).set(auth(token));
    const found = (response.body.data as { action: string }[]).find((row) =>
      row.action.includes(contains),
    );
    if (found) return { response, found };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No audit entry containing "${contains}" was written`);
}

describe('admin reports', () => {
  it('downloads the sales report as an Excel workbook', async () => {
    const buyer = await readyBuyer({ quantity: 2 });
    const placed = await placeOrder(buyer.token);
    const { token: adminToken } = await loginAsAdmin();

    const response = await binaryGet(`${API}/admin/reports/sales.xlsx`, adminToken);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe(XLSX);
    expect(response.headers['content-disposition']).toContain('sarvodaya-sales-');
    const body = response.body as Buffer;
    expect(body.subarray(0, 2).toString()).toBe('PK');
    expect(body.length).toBeGreaterThan(2000);
    expect(placed.status).toBe(201);
  });

  it('downloads the line level order report', async () => {
    const buyer = await readyBuyer({ quantity: 2 });
    await placeOrder(buyer.token);
    const { token: adminToken } = await loginAsAdmin();

    const response = await binaryGet(
      `${API}/admin/reports/orders.xlsx?from=2020-01-01&to=2999-12-31`,
      adminToken,
    );

    expect(response.status).toBe(200);
    expect((response.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect(response.headers['content-disposition']).toContain('sarvodaya-orders-');
  });

  it('refuses an impossible date range and keeps reports admin only', async () => {
    const buyer = await readyBuyer({ quantity: 1 });
    const { token: adminToken } = await loginAsAdmin();

    const invalid = await api()
      .get(`${API}/admin/reports/sales.xlsx?from=2026-05-01&to=2026-01-01`)
      .set(auth(adminToken));
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('REPORT_RANGE_INVALID');

    const forbidden = await api().get(`${API}/admin/reports/sales.xlsx`).set(auth(buyer.token));
    expect(forbidden.status).toBe(403);
  });
});

describe('admin audit log', () => {
  it('records an admin change with who, what and the request id', async () => {
    const buyer = await readyBuyer({ quantity: 1 });
    const { token: adminToken } = await loginAsAdmin();

    const changed = await api()
      .patch(`${API}/admin/products/${buyer.tmtProduct.id}/stock`)
      .set(auth(adminToken))
      .send({ adjustment: -5 });
    expect(changed.status).toBe(200);

    const { found } = await waitForAudit(adminToken, '/admin/products');
    expect(found).toMatchObject({
      entityType: 'PRODUCT',
      entityId: buyer.tmtProduct.id,
      action: 'PATCH /admin/products/:id/stock',
    });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: buyer.tmtProduct.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry.actorPhone).toBe('9999999999');
    expect(entry.actorName).toBe('Shop Owner');
    expect(entry.requestId).toBeTruthy();
    expect(entry.metadata).toMatchObject({ adjustment: -5 });
  });

  it('does not log reads or failed changes, and shows the trail to admins only', async () => {
    const buyer = await readyBuyer({ quantity: 1 });
    const { token: adminToken } = await loginAsAdmin();

    await api().get(`${API}/admin/orders`).set(auth(adminToken));
    const failed = await api()
      .patch(`${API}/admin/products/${buyer.tmtProduct.id}/stock`)
      .set(auth(adminToken))
      .send({ adjustment: 5, stockQuantity: 10 });
    expect(failed.status).toBe(400);

    const logs = await api().get(`${API}/admin/audit-logs`).set(auth(adminToken));
    expect(logs.status).toBe(200);
    expect(logs.body.data).toHaveLength(0);

    const forbidden = await api().get(`${API}/admin/audit-logs`).set(auth(buyer.token));
    expect(forbidden.status).toBe(403);
  });
});

describe('admin directory', () => {
  it('lists customers with what they have bought', async () => {
    const buyer = await readyBuyer({ quantity: 1 });
    await placeOrder(buyer.token);
    const { token: adminToken } = await loginAsAdmin();

    const response = await api().get(`${API}/admin/customers`).set(auth(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0]).toMatchObject({
      phone: '9876543210',
      orders: 1,
      totalPurchasesPaise: 16_850,
      amountPaidPaise: 0,
    });
    expect(response.body.data[0].lastOrderAt).toBeTruthy();
  });

  it('lists contractors with their credit limit and outstanding balance', async () => {
    await createShopFixture();
    const contractor = await loginAs('9123456780', AccountType.CONTRACTOR, 'Suresh Patil');
    const { token: adminToken } = await loginAsAdmin();

    await api()
      .post(`${API}/admin/credit-terms`)
      .set(auth(adminToken))
      .send({ contractorId: contractor.user.id, creditLimitPaise: 500_000, paymentTermDays: 30 });

    const response = await api().get(`${API}/admin/contractors`).set(auth(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      phone: '9123456780',
      orders: 0,
      credit: {
        isEnabled: true,
        creditLimitPaise: 500_000,
        paymentTermDays: 30,
        outstandingPaise: 0,
      },
    });
  });

  it('searches the directory and refuses it to customers', async () => {
    const buyer = await readyBuyer({ quantity: 1 });
    const { token: adminToken } = await loginAsAdmin();

    const found = await api()
      .get(`${API}/admin/customers?search=9876543210`)
      .set(auth(adminToken));
    expect(found.body.data).toHaveLength(1);

    const missing = await api().get(`${API}/admin/customers?search=99999`).set(auth(adminToken));
    expect(missing.body.data).toHaveLength(0);

    const forbidden = await api().get(`${API}/admin/customers`).set(auth(buyer.token));
    expect(forbidden.status).toBe(403);
  });
});
