import { beforeEach, describe, expect, it } from 'vitest';
import { API, api } from './helpers';
import { createCategoryFixture, productData } from './catalog-helpers';
import { prisma } from '../src/lib/prisma';

let ids: Awaited<ReturnType<typeof createCategoryFixture>>;

beforeEach(async () => {
  ids = await createCategoryFixture();

  await prisma.product.create({
    data: productData({ sku: 'CAT-A', categoryId: ids.tmt.id }),
  });
  // Out of stock but still visible.
  await prisma.product.create({
    data: productData({
      sku: 'CAT-B',
      name: 'JSW Neosteel 10 mm TMT Bar',
      brand: 'JSW',
      pricePaise: 6675,
      stockQuantity: 0,
      categoryId: ids.tmt.id,
    }),
  });
  await prisma.product.create({
    data: productData({
      sku: 'CAT-C',
      name: 'UltraTech OPC 53 Cement',
      brand: 'UltraTech',
      sizeVariant: '50 kg bag',
      unit: 'BAG',
      pricePaise: 41000,
      stockQuantity: 50,
      categoryId: ids.opc.id,
    }),
  });
  // Hidden product, must never appear in the public API.
  await prisma.product.create({
    data: productData({
      sku: 'CAT-D',
      name: 'Hidden Berger Paint',
      brand: 'Berger',
      pricePaise: 500000,
      categoryId: ids.cement.id,
      isActive: false,
    }),
  });
});

describe('GET /categories', () => {
  it('returns the category tree with product counts', async () => {
    const response = await api().get(`${API}/categories`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);

    const steel = response.body.data[0];
    expect(steel).toMatchObject({ name: 'Steel', slug: 'steel', productCount: 0 });
    expect(steel.children).toHaveLength(1);
    expect(steel.children[0]).toMatchObject({
      name: 'TMT Bars',
      slug: 'tmt-bars',
      productCount: 2,
    });

    const cement = response.body.data[1];
    expect(cement.children[0]).toMatchObject({ name: 'OPC Cement', productCount: 1 });
  });

  it('hides inactive categories', async () => {
    await prisma.category.update({ where: { id: ids.opc.id }, data: { isActive: false } });

    const response = await api().get(`${API}/categories`);

    expect(response.status).toBe(200);
    expect(response.body.data[1].children).toHaveLength(0);
  });
});

describe('GET /products', () => {
  it('lists only visible products with an in-stock flag and pagination meta', async () => {
    const response = await api().get(`${API}/products`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.meta).toMatchObject({ page: 1, limit: 20, total: 3, totalPages: 1 });

    const skuList = response.body.data.map((product: { sku: string }) => product.sku);
    expect(skuList).not.toContain('CAT-D');

    const outOfStock = response.body.data.find((product: { sku: string }) => product.sku === 'CAT-B');
    expect(outOfStock.inStock).toBe(false);
    expect(outOfStock).not.toHaveProperty('stockQuantity');

    const inStock = response.body.data.find((product: { sku: string }) => product.sku === 'CAT-A');
    expect(inStock).toMatchObject({
      name: 'TATA Tiscon 8 mm TMT Bar',
      brand: 'TATA Tiscon',
      unit: 'kg',
      pricePaise: 6850,
      inStock: true,
    });
    expect(inStock.category).toMatchObject({ name: 'TMT Bars', slug: 'tmt-bars' });
  });

  it('searches by name, brand and sku', async () => {
    const byName = await api().get(`${API}/products?search=tiscon`);
    expect(byName.body.data).toHaveLength(1);
    expect(byName.body.data[0].sku).toBe('CAT-A');

    const byBrand = await api().get(`${API}/products?search=ultratech`);
    expect(byBrand.body.data).toHaveLength(1);
    expect(byBrand.body.data[0].sku).toBe('CAT-C');

    const bySku = await api().get(`${API}/products?search=CAT-B`);
    expect(bySku.body.data).toHaveLength(1);
    expect(bySku.body.data[0].sku).toBe('CAT-B');

    // The hidden product matches the search but must stay hidden.
    const hidden = await api().get(`${API}/products?search=hidden`);
    expect(hidden.body.data).toHaveLength(0);
  });

  it('filters by parent category including sub-categories', async () => {
    const steel = await api().get(`${API}/products?category=steel`);
    expect(steel.status).toBe(200);
    expect(steel.body.data.map((product: { sku: string }) => product.sku).sort()).toEqual([
      'CAT-A',
      'CAT-B',
    ]);

    const cement = await api().get(`${API}/products?category=cement`);
    expect(cement.body.data.map((product: { sku: string }) => product.sku)).toEqual(['CAT-C']);
  });

  it('returns an empty page for an unknown category slug', async () => {
    const response = await api().get(`${API}/products?category=does-not-exist`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(0);
    expect(response.body.meta.total).toBe(0);
  });

  it('filters by brand, price range and stock', async () => {
    const brand = await api().get(`${API}/products?brand=tata%20tiscon`);
    expect(brand.body.data).toHaveLength(1);
    expect(brand.body.data[0].sku).toBe('CAT-A');

    const priceRange = await api().get(`${API}/products?minPricePaise=6000&maxPricePaise=7000`);
    expect(priceRange.body.data.map((product: { sku: string }) => product.sku).sort()).toEqual([
      'CAT-A',
      'CAT-B',
    ]);

    const outOfStock = await api().get(`${API}/products?inStock=false`);
    expect(outOfStock.body.data.map((product: { sku: string }) => product.sku)).toEqual(['CAT-B']);
  });

  it('sorts and paginates', async () => {
    const cheapest = await api().get(`${API}/products?sort=price_asc`);
    expect(cheapest.body.data.map((product: { pricePaise: number }) => product.pricePaise)).toEqual([
      6675, 6850, 41000,
    ]);

    const secondPage = await api().get(`${API}/products?sort=price_asc&limit=2&page=2`);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.data[0].pricePaise).toBe(41000);
    expect(secondPage.body.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('validates the query string', async () => {
    const badRange = await api().get(`${API}/products?minPricePaise=9000&maxPricePaise=100`);
    expect(badRange.status).toBe(400);
    expect(badRange.body.error.code).toBe('VALIDATION_ERROR');
    expect(badRange.body.error.details[0].field).toBe('minPricePaise');

    const badSort = await api().get(`${API}/products?sort=cheapest`);
    expect(badSort.status).toBe(400);

    const badLimit = await api().get(`${API}/products?limit=abc`);
    expect(badLimit.status).toBe(400);
  });
});

describe('GET /products/:id', () => {
  it('returns a visible product by id', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'CAT-A' } });

    const response = await api().get(`${API}/products/${product.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: product.id, sku: 'CAT-A', inStock: true });
    expect(response.body.data).not.toHaveProperty('isActive');
  });

  it('hides hidden products and unknown ids', async () => {
    const hidden = await prisma.product.findUniqueOrThrow({ where: { sku: 'CAT-D' } });

    const hiddenResponse = await api().get(`${API}/products/${hidden.id}`);
    expect(hiddenResponse.status).toBe(404);
    expect(hiddenResponse.body.error.code).toBe('NOT_FOUND');

    const missing = await api().get(`${API}/products/3f0f2a3e-8a6b-4f5c-9d1e-2b3c4d5e6f70`);
    expect(missing.status).toBe(404);

    const badId = await api().get(`${API}/products/not-a-uuid`);
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('VALIDATION_ERROR');
  });
});
