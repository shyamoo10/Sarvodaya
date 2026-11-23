import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { api, API, auth } from './helpers';
import { loginAsAdmin } from './catalog-helpers';
import { createAddress, createShopFixture, loginAs } from './pricing-helpers';
import { addToCart, placeOrder, readyBuyer } from './order-helpers';

describe('contractor credit terms', () => {
  it('lets the admin give pay-later terms to a contractor', async () => {
    const contractor = await loginAs('9123456780', AccountType.CONTRACTOR);
    const customer = await loginAs('9876543210', AccountType.CUSTOMER);
    const { token: adminToken } = await loginAsAdmin();

    const created = await api()
      .post(`${API}/admin/credit-terms`)
      .set(auth(adminToken))
      .send({
        contractorId: contractor.user.id,
        creditLimitPaise: 5_000_000,
        paymentTermDays: 30,
        notes: 'Agreed with the owner',
      });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      contractorId: contractor.user.id,
      isEnabled: true,
      creditLimitPaise: 5_000_000,
      paymentTermDays: 30,
      outstandingPaise: 0,
      availablePaise: 5_000_000,
    });

    const duplicate = await api()
      .post(`${API}/admin/credit-terms`)
      .set(auth(adminToken))
      .send({ contractorId: contractor.user.id });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CREDIT_TERMS_EXIST');

    const notAContractor = await api()
      .post(`${API}/admin/credit-terms`)
      .set(auth(adminToken))
      .send({ contractorId: customer.user.id });
    expect(notAContractor.status).toBe(404);

    const patched = await api()
      .patch(`${API}/admin/credit-terms/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ paymentTermDays: 45 });
    expect(patched.body.data.paymentTermDays).toBe(45);

    const listed = await api()
      .get(`${API}/admin/credit-terms?search=9123456780`)
      .set(auth(adminToken));
    expect(listed.body.data).toHaveLength(1);
  });

  it('accepts a pay-later checkout from a contractor with credit', async () => {
    const { token } = await readyBuyer({
      phone: '9123456780',
      accountType: AccountType.CONTRACTOR,
      quantity: 2,
    });
    const { token: adminToken } = await loginAsAdmin();

    const contractor = await prisma.user.findUniqueOrThrow({ where: { phone: '9123456780' } });
    await api()
      .post(`${API}/admin/credit-terms`)
      .set(auth(adminToken))
      .send({ contractorId: contractor.id, creditLimitPaise: 100_000 });

    const placed = await placeOrder(token, { paymentMethod: 'CREDIT' });
    expect(placed.status).toBe(201);
    expect(placed.body.data.payment).toMatchObject({
      method: 'CREDIT',
      methodLabel: 'Pay later',
      status: 'PENDING',
      isPayLater: true,
      amountDuePaise: 23_700,
      canPayOnline: false,
    });

    const terms = await api()
      .get(`${API}/admin/credit-terms?search=9123456780`)
      .set(auth(adminToken));
    expect(terms.body.data[0].outstandingPaise).toBe(23_700);
    expect(terms.body.data[0].availablePaise).toBe(76_300);
  });

  it('refuses pay later for customers and for contractors without terms', async () => {
    const fixture = await createShopFixture();

    const customer = await loginAs('9876543210', AccountType.CUSTOMER);
    await createAddress(customer.user.id as string, '411005', 18.5308, 73.8478);
    await addToCart(customer.token, fixture.tmtProduct.id, 1);

    const asCustomer = await placeOrder(customer.token, { paymentMethod: 'CREDIT' });
    expect(asCustomer.status).toBe(403);
    expect(asCustomer.body.error.code).toBe('CREDIT_NOT_AVAILABLE');

    const contractor = await loginAs('9123456780', AccountType.CONTRACTOR);
    await createAddress(contractor.user.id as string, '411005', 18.5308, 73.8478);
    await addToCart(contractor.token, fixture.tmtProduct.id, 1);

    const withoutTerms = await placeOrder(contractor.token, { paymentMethod: 'CREDIT' });
    expect(withoutTerms.status).toBe(403);
    expect(withoutTerms.body.error.code).toBe('CREDIT_NOT_AVAILABLE');
  });

  it('stops pay later once the terms are switched off', async () => {
    const { token } = await readyBuyer({
      phone: '9123456780',
      accountType: AccountType.CONTRACTOR,
      quantity: 1,
    });
    const { token: adminToken } = await loginAsAdmin();
    const contractor = await prisma.user.findUniqueOrThrow({ where: { phone: '9123456780' } });

    const created = await api()
      .post(`${API}/admin/credit-terms`)
      .set(auth(adminToken))
      .send({ contractorId: contractor.id });
    await api()
      .patch(`${API}/admin/credit-terms/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ isEnabled: false });

    const refused = await placeOrder(token, { paymentMethod: 'CREDIT' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CREDIT_NOT_AVAILABLE');
  });

  it('never lets the outstanding balance pass the credit limit', async () => {
    const { token } = await readyBuyer({
      phone: '9123456780',
      accountType: AccountType.CONTRACTOR,
      quantity: 2,
    });
    const { token: adminToken } = await loginAsAdmin();
    const contractor = await prisma.user.findUniqueOrThrow({ where: { phone: '9123456780' } });

    await api()
      .post(`${API}/admin/credit-terms`)
      .set(auth(adminToken))
      .send({ contractorId: contractor.id, creditLimitPaise: 20_000 });

    const refused = await placeOrder(token, { paymentMethod: 'CREDIT' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
    expect(refused.body.error.details).toMatchObject({
      creditLimitPaise: 20_000,
      outstandingPaise: 0,
      availablePaise: 20_000,
    });

    // Nothing was ordered, so the cart is untouched and stock is intact.
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.cartItem.count()).toBe(1);
  });
});
