import { beforeEach, describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { API, api, auth, signUpOrLogin } from './helpers';
import { buildWorkbook, createCategoryFixture, loginAsAdmin, productData } from './catalog-helpers';
import { prisma } from '../src/lib/prisma';

let token: string;
let ids: Awaited<ReturnType<typeof createCategoryFixture>>;

beforeEach(async () => {
  ({ token } = await loginAsAdmin());
  ids = await createCategoryFixture();
});

const upload = (buffer: Buffer, filename = 'products.xlsx', bearer = token) =>
  api()
    .post(`${API}/admin/products/import`)
    .set(auth(bearer))
    .attach('file', buffer, {
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

const validRows = [
  {
    sku: 'imp-001',
    name: 'ACC Gold PPC Cement',
    category: 'Cement > OPC Cement',
    brand: 'ACC',
    size_variant: '50 kg bag',
    unit: 'bag',
    price: 390.5,
    stock: 100,
    photos: 'https://example.com/acc-1.jpg, https://example.com/acc-2.jpg',
    description: 'Weather resistant PPC',
  },
  {
    sku: 'IMP-002',
    name: 'JSW Neosteel 12 mm',
    category: 'TMT Bars',
    brand: 'JSW',
    unit: 'kg',
    price: 66.75,
    stock: 0,
  },
];

describe('POST /admin/products/import', () => {
  it('imports products from an xlsx sheet', async () => {
    const response = await upload(await buildWorkbook(validRows));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalRows: 2,
      created: 2,
      updated: 0,
      failed: 0,
      errors: [],
    });

    const cement = await prisma.product.findUniqueOrThrow({ where: { sku: 'IMP-001' } });
    expect(cement).toMatchObject({
      name: 'ACC Gold PPC Cement',
      brand: 'ACC',
      unit: 'BAG',
      pricePaise: 39050,
      stockQuantity: 100,
      categoryId: ids.opc.id,
    });
    expect(cement.photos).toHaveLength(2);

    const steel = await prisma.product.findUniqueOrThrow({ where: { sku: 'IMP-002' } });
    expect(steel).toMatchObject({ unit: 'KG', pricePaise: 6675, categoryId: ids.tmt.id });
  });

  it('is safe to re-run: existing SKUs are updated, not duplicated', async () => {
    await upload(await buildWorkbook(validRows));

    const second = await upload(
      await buildWorkbook([{ ...validRows[0], price: 400, brand: 'ACC Cement' }]),
    );

    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ totalRows: 1, created: 0, updated: 1, failed: 0 });

    const products = await prisma.product.findMany({ where: { sku: 'IMP-001' } });
    expect(products).toHaveLength(1);
    expect(products[0]?.pricePaise).toBe(40000);
    expect(products[0]?.brand).toBe('ACC Cement');
  });

  it('reports bad rows individually and still imports the good ones', async () => {
    const buffer = await buildWorkbook([
      { ...validRows[0], sku: 'IMP-OK' },
      { ...validRows[1], sku: 'IMP-BAD-UNIT', unit: 'bottle' },
      { ...validRows[1], sku: 'IMP-BAD-CATEGORY', category: 'Unobtanium' },
      { ...validRows[1], sku: 'IMP-BAD-NAME', name: '' },
      { ...validRows[1], sku: 'IMP-BAD-PRICE', price: 'free' },
    ]);

    const response = await upload(buffer);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ totalRows: 5, created: 1, updated: 0, failed: 4 });

    const errors = response.body.data.errors as { row: number; sku: string; field: string }[];
    expect(errors).toHaveLength(4);
    expect(errors.map((error) => error.row)).toEqual([3, 4, 5, 6]);
    expect(errors.find((error) => error.sku === 'IMP-BAD-UNIT')?.field).toBe('unit');
    expect(errors.find((error) => error.sku === 'IMP-BAD-CATEGORY')?.field).toBe('category');
    expect(errors.find((error) => error.sku === 'IMP-BAD-NAME')?.field).toBe('name');
    expect(errors.find((error) => error.sku === 'IMP-BAD-PRICE')?.field).toBe('price');

    await expect(prisma.product.count()).resolves.toBe(1);
  });

  it('keeps a hidden product hidden when it is re-imported', async () => {
    await prisma.product.create({
      data: productData({ sku: 'IMP-001', categoryId: ids.opc.id, isActive: false }),
    });

    const response = await upload(await buildWorkbook([validRows[0]]));

    expect(response.body.data).toMatchObject({ created: 0, updated: 1 });
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'IMP-001' } });
    expect(product.isActive).toBe(false);
    expect(product.pricePaise).toBe(39050);
  });

  it('rejects a sheet without the required columns', async () => {
    const buffer = await buildWorkbook([{ sku: 'IMP-001', name: 'Cement', price: 100 }], [
      'sku',
      'name',
      'price',
    ]);

    const response = await upload(buffer);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_IMPORT_FILE');
    expect(response.body.error.message).toContain('category');
    expect(response.body.error.message).toContain('unit');
  });

  it('rejects a missing file and a non-xlsx file', async () => {
    const missing = await api().post(`${API}/admin/products/import`).set(auth(token));
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('INVALID_IMPORT_FILE');

    const wrongType = await upload(Buffer.from('sku,name\nA,Product'), 'products.csv');
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.code).toBe('INVALID_IMPORT_FILE');

    const garbage = await upload(Buffer.from('this is not a workbook'), 'products.xlsx');
    expect(garbage.status).toBe(400);
    expect(garbage.body.error.code).toBe('INVALID_IMPORT_FILE');
  });

  it('is admin only', async () => {
    const { token: customerToken } = await signUpOrLogin('9876500060', {
      accountType: AccountType.CUSTOMER,
      name: 'Ramesh Kumar',
    });

    const response = await upload(await buildWorkbook(validRows), 'products.xlsx', customerToken);

    expect(response.status).toBe(403);
  });
});
