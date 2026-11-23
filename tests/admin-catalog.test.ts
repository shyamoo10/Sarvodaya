import { beforeEach, describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { API, api, auth, signUpOrLogin } from './helpers';
import { createCategoryFixture, loginAsAdmin, productData } from './catalog-helpers';
import { prisma } from '../src/lib/prisma';

let token: string;
let ids: Awaited<ReturnType<typeof createCategoryFixture>>;

beforeEach(async () => {
  ({ token } = await loginAsAdmin());
  ids = await createCategoryFixture();
});

describe('admin catalogue access', () => {
  it('rejects non-admin users on every admin catalogue route', async () => {
    const { token: customerToken } = await signUpOrLogin('9876500050', {
      accountType: AccountType.CUSTOMER,
      name: 'Ramesh Kumar',
    });

    const create = await api()
      .post(`${API}/admin/products`)
      .set(auth(customerToken))
      .send({ sku: 'X-1', name: 'Nope', brand: 'Nope', unit: 'kg', pricePaise: 100, categoryId: ids.tmt.id });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('FORBIDDEN');

    const list = await api().get(`${API}/admin/categories`).set(auth(customerToken));
    expect(list.status).toBe(403);
  });

  it('lists categories including hidden ones for admins', async () => {
    await prisma.category.update({ where: { id: ids.opc.id }, data: { isActive: false } });

    const response = await api().get(`${API}/admin/categories`).set(auth(token));

    expect(response.status).toBe(200);
    expect(response.body.data[1].children[0]).toMatchObject({
      name: 'OPC Cement',
      isActive: false,
    });
  });
});

describe('admin categories', () => {
  it('creates a category and a sub-category', async () => {
    const parent = await api()
      .post(`${API}/admin/categories`)
      .set(auth(token))
      .send({ name: 'Paint', description: 'Emulsions and enamels' });

    expect(parent.status).toBe(201);
    expect(parent.body.data).toMatchObject({ name: 'Paint', slug: 'paint', parentId: null });

    const child = await api()
      .post(`${API}/admin/categories`)
      .set(auth(token))
      .send({ name: 'Interior Emulsion', parentId: parent.body.data.id });

    expect(child.status).toBe(201);
    expect(child.body.data).toMatchObject({
      name: 'Interior Emulsion',
      slug: 'interior-emulsion',
      parentId: parent.body.data.id,
    });
  });

  it('refuses duplicate names and a third level', async () => {
    const duplicate = await api()
      .post(`${API}/admin/categories`)
      .set(auth(token))
      .send({ name: 'Steel' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_CATEGORY');

    const thirdLevel = await api()
      .post(`${API}/admin/categories`)
      .set(auth(token))
      .send({ name: 'Fe 500', parentId: ids.tmt.id });
    expect(thirdLevel.status).toBe(400);
    expect(thirdLevel.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('updates a category', async () => {
    const response = await api()
      .patch(`${API}/admin/categories/${ids.tmt.id}`)
      .set(auth(token))
      .send({ name: 'TMT Steel Bars', sortOrder: 5 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ name: 'TMT Steel Bars', sortOrder: 5, slug: 'tmt-bars' });
  });

  it('deletes only empty categories', async () => {
    const created = await api()
      .post(`${API}/admin/categories`)
      .set(auth(token))
      .send({ name: 'Temporary' });

    const deleted = await api()
      .delete(`${API}/admin/categories/${created.body.data.id}`)
      .set(auth(token));
    expect(deleted.status).toBe(204);

    await prisma.product.create({ data: productData({ categoryId: ids.tmt.id }) });
    const inUse = await api().delete(`${API}/admin/categories/${ids.tmt.id}`).set(auth(token));
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('CATEGORY_IN_USE');

    const parentInUse = await api().delete(`${API}/admin/categories/${ids.steel.id}`).set(auth(token));
    expect(parentInUse.status).toBe(409);
  });
});

describe('admin products', () => {
  const createProduct = (overrides: Record<string, unknown> = {}) => ({
    sku: 'ADM-001',
    name: 'TATA Tiscon 8 mm TMT Bar',
    description: 'Fe 550D ribbed bar',
    brand: 'TATA Tiscon',
    sizeVariant: '8 mm',
    unit: 'kg',
    pricePaise: 6850,
    stockQuantity: 120,
    photos: ['https://example.com/tmt.jpg'],
    categoryId: ids.tmt.id,
    ...overrides,
  });

  it('creates a product', async () => {
    const response = await api()
      .post(`${API}/admin/products`)
      .set(auth(token))
      .send(createProduct());

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      sku: 'ADM-001',
      unit: 'kg',
      pricePaise: 6850,
      stockQuantity: 120,
      isActive: true,
      categoryId: ids.tmt.id,
      inStock: true,
    });
  });

  it('validates the product payload', async () => {
    const duplicateSku = createProduct({ sku: 'ADM-001' });
    await api().post(`${API}/admin/products`).set(auth(token)).send(duplicateSku).expect(201);

    const duplicate = await api()
      .post(`${API}/admin/products`)
      .set(auth(token))
      .send(duplicateSku);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('SKU_ALREADY_EXISTS');

    const unknownCategory = await api()
      .post(`${API}/admin/products`)
      .set(auth(token))
      .send(createProduct({ sku: 'ADM-002', categoryId: '3f0f2a3e-8a6b-4f5c-9d1e-2b3c4d5e6f70' }));
    expect(unknownCategory.status).toBe(404);

    const badPrice = await api()
      .post(`${API}/admin/products`)
      .set(auth(token))
      .send(createProduct({ sku: 'ADM-003', pricePaise: 68.5 }));
    expect(badPrice.status).toBe(400);
    expect(badPrice.body.error.code).toBe('VALIDATION_ERROR');

    const badUnit = await api()
      .post(`${API}/admin/products`)
      .set(auth(token))
      .send(createProduct({ sku: 'ADM-004', unit: 'bottle' }));
    expect(badUnit.status).toBe(400);
  });

  it('updates price and hides a product', async () => {
    const created = await api()
      .post(`${API}/admin/products`)
      .set(auth(token))
      .send(createProduct());
    const id = created.body.data.id as string;

    const updated = await api()
      .patch(`${API}/admin/products/${id}`)
      .set(auth(token))
      .send({ pricePaise: 7200, isActive: false });

    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ pricePaise: 7200, isActive: false });

    const publicList = await api().get(`${API}/products`);
    expect(publicList.body.data).toHaveLength(0);

    const publicDetail = await api().get(`${API}/products/${id}`);
    expect(publicDetail.status).toBe(404);

    const adminDetail = await api().get(`${API}/admin/products/${id}`).set(auth(token));
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.data.isActive).toBe(false);

    const hiddenOnly = await api().get(`${API}/admin/products?isActive=false`).set(auth(token));
    expect(hiddenOnly.body.data).toHaveLength(1);
  });

  it('changes stock with an absolute value or an adjustment', async () => {
    const created = await api()
      .post(`${API}/admin/products`)
      .set(auth(token))
      .send(createProduct());
    const id = created.body.data.id as string;

    const absolute = await api()
      .patch(`${API}/admin/products/${id}/stock`)
      .set(auth(token))
      .send({ stockQuantity: 25 });
    expect(absolute.status).toBe(200);
    expect(absolute.body.data.stockQuantity).toBe(25);

    const decrease = await api()
      .patch(`${API}/admin/products/${id}/stock`)
      .set(auth(token))
      .send({ adjustment: -5 });
    expect(decrease.body.data.stockQuantity).toBe(20);

    const restock = await api()
      .patch(`${API}/admin/products/${id}/stock`)
      .set(auth(token))
      .send({ adjustment: 100 });
    expect(restock.body.data.stockQuantity).toBe(120);

    const tooMuch = await api()
      .patch(`${API}/admin/products/${id}/stock`)
      .set(auth(token))
      .send({ adjustment: -500 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('VALIDATION_ERROR');

    const both = await api()
      .patch(`${API}/admin/products/${id}/stock`)
      .set(auth(token))
      .send({ stockQuantity: 5, adjustment: 1 });
    expect(both.status).toBe(400);

    const none = await api()
      .patch(`${API}/admin/products/${id}/stock`)
      .set(auth(token))
      .send({});
    expect(none.status).toBe(400);

    const outOfStock = await api()
      .patch(`${API}/admin/products/${id}/stock`)
      .set(auth(token))
      .send({ stockQuantity: 0 });
    expect(outOfStock.body.data.inStock).toBe(false);
  });

  it('searches and paginates the admin list', async () => {
    await api().post(`${API}/admin/products`).set(auth(token)).send(createProduct());
    await api()
      .post(`${API}/admin/products`)
      .set(auth(token))
      .send(createProduct({ sku: 'ADM-002', name: 'UltraTech Cement', brand: 'UltraTech', categoryId: ids.opc.id }));

    const search = await api().get(`${API}/admin/products?search=ultratech`).set(auth(token));
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].sku).toBe('ADM-002');
    expect(search.body.meta.total).toBe(1);

    const page = await api().get(`${API}/admin/products?limit=1`).set(auth(token));
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta.totalPages).toBe(2);
  });
});
