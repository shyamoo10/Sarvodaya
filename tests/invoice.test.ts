import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { api, API, auth, signUpOrLogin } from './helpers';
import { loginAsAdmin } from './catalog-helpers';
import { createAddress, createShopFixture } from './pricing-helpers';
import { addToCart, placeOrder, readyBuyer } from './order-helpers';

describe('invoices', () => {
  it('gives an order without a GST number a plain bill', async () => {
    const { token } = await readyBuyer({ quantity: 2 });
    const placed = await placeOrder(token);
    expect(placed.status).toBe(201);

    const details = await api()
      .get(`${API}/orders/${placed.body.data.id}/invoice/details`)
      .set(auth(token));

    expect(details.status).toBe(200);
    expect(details.body.data.kind).toBe('BILL');
    expect(details.body.data.invoiceNumber).toMatch(/^SAR-INV-\d{6}$/);
    expect(details.body.data.buyerGstNumber).toBeNull();
    expect(details.body.data.itemTotalPaise).toBe(13_700);
    expect(details.body.data.chargesPaise).toBe(10_000);
    expect(details.body.data.grandTotalPaise).toBe(23_700);

    const stored = await prisma.invoice.findUnique({
      where: { orderId: placed.body.data.id as string },
    });
    expect(stored?.kind).toBe('BILL');
  });

  it('creates a tax invoice when the buyer gave a GST number', async () => {
    const fixture = await createShopFixture();
    const { token, user } = await signUpOrLogin('9123456780', {
      accountType: AccountType.CONTRACTOR,
      name: 'Suresh Patil',
      companyName: 'Patil Constructions',
      gstNumber: '27ABCDE1234F1Z5',
    });
    await createAddress(user.id as string, '411005', 18.5308, 73.8478);
    await addToCart(token, fixture.tmtProduct.id, 1);

    const placed = await placeOrder(token);
    expect(placed.status).toBe(201);

    const details = await api()
      .get(`${API}/orders/${placed.body.data.id}/invoice/details`)
      .set(auth(token));

    expect(details.body.data).toMatchObject({
      kind: 'TAX_INVOICE',
      buyerGstNumber: '27ABCDE1234F1Z5',
    });
  });

  it('serves the invoice as a PDF, to the buyer and to the admin', async () => {
    const { token } = await readyBuyer({ quantity: 1 });
    const placed = await placeOrder(token);
    const orderId = placed.body.data.id as string;

    const pdf = await api().get(`${API}/orders/${orderId}/invoice`).set(auth(token));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('inline');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.body.length).toBeGreaterThan(1000);

    const { token: adminToken } = await loginAsAdmin();
    const adminPdf = await api()
      .get(`${API}/admin/orders/${orderId}/invoice`)
      .set(auth(adminToken));
    expect(adminPdf.status).toBe(200);
    expect(adminPdf.headers['content-disposition']).toContain('attachment');

    // Another customer cannot read someone else's invoice.
    const other = await signUpOrLogin('9876543212', {
      accountType: AccountType.CUSTOMER,
      name: 'Other Buyer',
    });
    const hidden = await api().get(`${API}/orders/${orderId}/invoice`).set(auth(other.token));
    expect(hidden.status).toBe(404);
  });

  it('numbers invoices separately from orders and keeps the amount at the time of sale', async () => {
    const first = await readyBuyer({ quantity: 1 });
    const firstOrder = await placeOrder(first.token);
    const firstInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { orderId: firstOrder.body.data.id },
    });
    expect(firstInvoice.invoiceNumber).toBe('SAR-INV-000001');

    const secondBuyer = await signUpOrLogin('9876543211', {
      accountType: AccountType.CUSTOMER,
      name: 'Second Buyer',
    });
    await createAddress(secondBuyer.user.id as string, '411005', 18.5308, 73.8478);
    await addToCart(secondBuyer.token, first.cementBag.id, 1);
    const secondOrder = await placeOrder(secondBuyer.token);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { orderId: secondOrder.body.data.id },
    });
    expect(invoice.invoiceNumber).toBe('SAR-INV-000002');

    // A later price change never rewrites the invoice.
    await prisma.product.update({
      where: { id: first.cementBag.id },
      data: { pricePaise: 99_999 },
    });
    const details = await api()
      .get(`${API}/orders/${secondOrder.body.data.id}/invoice/details`)
      .set(auth(secondBuyer.token));
    expect(details.body.data.itemTotalPaise).toBe(41_000);
  });
});
