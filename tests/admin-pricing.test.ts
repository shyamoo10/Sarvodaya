import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { api, API, auth } from './helpers';
import { loginAsAdmin } from './catalog-helpers';
import { createShopFixture, loginAs } from './pricing-helpers';

describe('admin pricing', () => {
  it('reads and changes the shop settings', async () => {
    await createShopFixture();
    const { token } = await loginAsAdmin();

    const before = await api().get(`${API}/admin/pricing/settings`).set(auth(token));
    expect(before.status).toBe(200);
    expect(before.body.data.minOrderAmountPaise).toBe(200_000);

    const updated = await api()
      .patch(`${API}/admin/pricing/settings`)
      .set(auth(token))
      .send({ minOrderAmountPaise: 300_000, minOrderChargePaise: 15_000, freeDeliveryAbovePaise: null });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      minOrderAmountPaise: 300_000,
      minOrderChargePaise: 15_000,
      freeDeliveryAbovePaise: null,
      freeDeliveryRadiusKm: 3,
    });

    const stored = await prisma.shopSettings.findUnique({ where: { id: 'default' } });
    expect(stored?.minOrderAmountPaise).toBe(300_000);

    const empty = await api().patch(`${API}/admin/pricing/settings`).set(auth(token)).send({});
    expect(empty.status).toBe(400);
  });

  it('manages contractor special prices', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token: adminToken } = await loginAsAdmin();
    const contractor = await loginAs('9123456780', AccountType.CONTRACTOR);
    const customer = await loginAs('9876543210', AccountType.CUSTOMER);

    const created = await api()
      .post(`${API}/admin/pricing/contractor-prices`)
      .set(auth(adminToken))
      .send({ contractorId: contractor.user.id, productId: tmtProduct.id, pricePaise: 6500 });
    expect(created.status).toBe(201);
    expect(created.body.data.pricePaise).toBe(6500);

    const duplicate = await api()
      .post(`${API}/admin/pricing/contractor-prices`)
      .set(auth(adminToken))
      .send({ contractorId: contractor.user.id, productId: tmtProduct.id, pricePaise: 6400 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONTRACTOR_PRICE_EXISTS');

    const notAContractor = await api()
      .post(`${API}/admin/pricing/contractor-prices`)
      .set(auth(adminToken))
      .send({ contractorId: customer.user.id, productId: tmtProduct.id, pricePaise: 6400 });
    expect(notAContractor.status).toBe(404);

    const id = created.body.data.id as string;
    const patched = await api()
      .patch(`${API}/admin/pricing/contractor-prices/${id}`)
      .set(auth(adminToken))
      .send({ pricePaise: 6600 });
    expect(patched.body.data.pricePaise).toBe(6600);

    const listed = await api()
      .get(`${API}/admin/pricing/contractor-prices?contractorId=${contractor.user.id}`)
      .set(auth(adminToken));
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.meta.total).toBe(1);

    const removed = await api()
      .delete(`${API}/admin/pricing/contractor-prices/${id}`)
      .set(auth(adminToken));
    expect(removed.status).toBe(204);
  });

  it('manages bulk quantity discounts', async () => {
    const { cement } = await createShopFixture();
    const { token } = await loginAsAdmin();

    const created = await api()
      .post(`${API}/admin/pricing/bulk-discounts`)
      .set(auth(token))
      .send({ name: 'Cement 50 bags', categoryId: cement.id, minQuantity: 50, discountBps: 500 });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ discountBps: 500, discountPercent: 5, minQuantity: 50 });

    const bothScopes = await api()
      .post(`${API}/admin/pricing/bulk-discounts`)
      .set(auth(token))
      .send({
        name: 'Confused rule',
        categoryId: cement.id,
        productId: '00000000-0000-4000-8000-000000000000',
        minQuantity: 10,
        discountBps: 300,
      });
    expect(bothScopes.status).toBe(400);
    expect(bothScopes.body.error.code).toBe('VALIDATION_ERROR');

    const id = created.body.data.id as string;
    const patched = await api()
      .patch(`${API}/admin/pricing/bulk-discounts/${id}`)
      .set(auth(token))
      .send({ discountBps: 400, isActive: false });
    expect(patched.body.data).toMatchObject({ discountBps: 400, isActive: false });

    const listed = await api()
      .get(`${API}/admin/pricing/bulk-discounts?search=Cement`)
      .set(auth(token));
    expect(listed.body.data).toHaveLength(1);

    const removed = await api()
      .delete(`${API}/admin/pricing/bulk-discounts/${id}`)
      .set(auth(token));
    expect(removed.status).toBe(204);
  });

  it('manages contractor percentage rules', async () => {
    const { cement } = await createShopFixture();
    const { token } = await loginAsAdmin();

    const created = await api()
      .post(`${API}/admin/pricing/contractor-rules`)
      .set(auth(token))
      .send({ name: '5% off cement', categoryId: cement.id, discountBps: 500 });
    expect(created.status).toBe(201);
    expect(created.body.data.category.slug).toBe('cement');

    const id = created.body.data.id as string;
    const patched = await api()
      .patch(`${API}/admin/pricing/contractor-rules/${id}`)
      .set(auth(token))
      .send({ discountBps: 700 });
    expect(patched.body.data.discountBps).toBe(700);

    const listed = await api().get(`${API}/admin/pricing/contractor-rules`).set(auth(token));
    expect(listed.body.data).toHaveLength(1);

    const removed = await api()
      .delete(`${API}/admin/pricing/contractor-rules/${id}`)
      .set(auth(token));
    expect(removed.status).toBe(204);
  });

  it('keeps pricing admin endpoints admin-only', async () => {
    const { token } = await loginAs('9876543210', AccountType.CUSTOMER);

    const forbidden = await api().get(`${API}/admin/pricing/settings`).set(auth(token));
    expect(forbidden.status).toBe(403);

    const anonymous = await api().get(`${API}/admin/pricing/settings`);
    expect(anonymous.status).toBe(401);
  });
});

describe('admin delivery', () => {
  it('manages distance slabs and refuses overlaps', async () => {
    await createShopFixture();
    const { token } = await loginAsAdmin();

    const listed = await api().get(`${API}/admin/delivery/slabs`).set(auth(token));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(3);

    const created = await api()
      .post(`${API}/admin/delivery/slabs`)
      .set(auth(token))
      .send({ fromKm: 30, toKm: 50, chargePaise: 70_000 });
    expect(created.status).toBe(201);

    const overlap = await api()
      .post(`${API}/admin/delivery/slabs`)
      .set(auth(token))
      .send({ fromKm: 4, toKm: 8, chargePaise: 12_000 });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('DELIVERY_SLAB_OVERLAP');

    const inverted = await api()
      .post(`${API}/admin/delivery/slabs`)
      .set(auth(token))
      .send({ fromKm: 60, toKm: 55, chargePaise: 10_000 });
    expect(inverted.status).toBe(400);

    const id = created.body.data.id as string;
    const patched = await api()
      .patch(`${API}/admin/delivery/slabs/${id}`)
      .set(auth(token))
      .send({ chargePaise: 75_000 });
    expect(patched.body.data.chargePaise).toBe(75_000);

    const removed = await api().delete(`${API}/admin/delivery/slabs/${id}`).set(auth(token));
    expect(removed.status).toBe(204);
  });

  it('manages the serviceable pincodes', async () => {
    await createShopFixture();
    const { token } = await loginAsAdmin();

    const created = await api()
      .post(`${API}/admin/delivery/pincodes`)
      .set(auth(token))
      .send({
        pincode: '411002',
        areaName: 'Kasba Peth',
        city: 'Pune',
        latitude: 18.5196,
        longitude: 73.8567,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.pincode).toBe('411002');

    const duplicate = await api()
      .post(`${API}/admin/delivery/pincodes`)
      .set(auth(token))
      .send({ pincode: '411002', latitude: 18.5, longitude: 73.8 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_PINCODE');

    const invalid = await api()
      .post(`${API}/admin/delivery/pincodes`)
      .set(auth(token))
      .send({ pincode: '12', latitude: 18.5, longitude: 73.8 });
    expect(invalid.status).toBe(400);

    const searched = await api()
      .get(`${API}/admin/delivery/pincodes?search=Baner`)
      .set(auth(token));
    expect(searched.body.data).toHaveLength(1);
    expect(searched.body.data[0].pincode).toBe('411045');

    const patched = await api()
      .patch(`${API}/admin/delivery/pincodes/411002`)
      .set(auth(token))
      .send({ isActive: false });
    expect(patched.body.data.isActive).toBe(false);

    const removed = await api().delete(`${API}/admin/delivery/pincodes/411002`).set(auth(token));
    expect(removed.status).toBe(204);
  });

  it('keeps delivery admin endpoints admin-only', async () => {
    const { token } = await loginAs('9876543210', AccountType.CUSTOMER);

    const forbidden = await api().get(`${API}/admin/delivery/pincodes`).set(auth(token));
    expect(forbidden.status).toBe(403);
  });
});
