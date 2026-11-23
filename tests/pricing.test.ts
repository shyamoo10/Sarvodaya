import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { api, API, auth } from './helpers';
import {
  createBulkDiscount,
  createContractorRule,
  createShopFixture,
  loginAs,
} from './pricing-helpers';

async function addItem(token: string, productId: string, quantity: number) {
  const response = await api()
    .post(`${API}/cart/items`)
    .set(auth(token))
    .send({ productId, quantity });

  expect(response.status).toBe(201);
  return response.body.data.items[0];
}

describe('pricing rules', () => {
  it('charges the normal price when no rule applies', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token } = await loginAs('9876543210', AccountType.CUSTOMER);

    const line = await addItem(token, tmtProduct.id, 2);

    expect(line.originalPricePaise).toBe(6850);
    expect(line.unitPricePaise).toBe(6850);
    expect(line.lineTotalPaise).toBe(13_700);
    expect(line.appliedRule).toMatchObject({ type: 'NORMAL_PRICE', id: null });
  });

  it('applies a bulk discount once the quantity reaches the threshold', async () => {
    const { tmtProduct } = await createShopFixture();
    await createBulkDiscount();
    const { token } = await loginAs('9876543210', AccountType.CUSTOMER);

    const belowThreshold = await addItem(token, tmtProduct.id, 9);
    expect(belowThreshold.unitPricePaise).toBe(6850);
    expect(belowThreshold.appliedRule.type).toBe('NORMAL_PRICE');

    const item = await prisma.cartItem.findFirst({ where: { productId: tmtProduct.id } });
    const response = await api()
      .patch(`${API}/cart/items/${item!.id}`)
      .set(auth(token))
      .send({ quantity: 10 });

    expect(response.status).toBe(200);
    const line = response.body.data.items[0];
    // 3% off 6850 paise = 6644.5, rounded to 6645.
    expect(line.unitPricePaise).toBe(6645);
    expect(line.originalPricePaise).toBe(6850);
    expect(line.appliedRule).toMatchObject({ type: 'BULK_DISCOUNT', label: 'Buy 10 or more - 3% off' });
  });

  it('gives contractors the percentage rule for the matching category', async () => {
    const { cement, cementBag } = await createShopFixture();
    await createContractorRule({ categoryId: cement.id });
    const { token } = await loginAs('9123456780', AccountType.CONTRACTOR);

    const line = await addItem(token, cementBag.id, 1);

    // The rule is on "Cement"; the product sits in its "OPC Cement" child.
    expect(line.unitPricePaise).toBe(38_950);
    expect(line.appliedRule).toMatchObject({
      type: 'CONTRACTOR_PERCENTAGE',
      label: 'Cement contractor discount',
    });
  });

  it('applies the bulk discount before the contractor percentage rule', async () => {
    const { cement, cementBag } = await createShopFixture();
    await createContractorRule({ categoryId: cement.id });
    await createBulkDiscount();
    const { token } = await loginAs('9123456780', AccountType.CONTRACTOR);

    const line = await addItem(token, cementBag.id, 10);

    // Bulk wins: 3% off instead of the contractor's 5%.
    expect(line.unitPricePaise).toBe(39_770);
    expect(line.appliedRule.type).toBe('BULK_DISCOUNT');
  });

  it('applies the contractor special price before every other rule', async () => {
    const { tmtProduct } = await createShopFixture();
    await createBulkDiscount();
    const { token, user } = await loginAs('9123456780', AccountType.CONTRACTOR);

    await prisma.contractorPrice.create({
      data: {
        contractorId: user.id as string,
        productId: tmtProduct.id,
        pricePaise: 6600,
      },
    });

    const line = await addItem(token, tmtProduct.id, 20);

    expect(line.unitPricePaise).toBe(6600);
    expect(line.originalPricePaise).toBe(6850);
    expect(line.appliedRule.type).toBe('CONTRACTOR_SPECIAL_PRICE');
    expect(line.appliedRule.id).toBeTruthy();
  });

  it('never gives contractor pricing to a customer', async () => {
    const { cement, cementBag } = await createShopFixture();
    await createContractorRule({ categoryId: cement.id });
    const { token } = await loginAs('9876543210', AccountType.CUSTOMER);

    const line = await addItem(token, cementBag.id, 1);

    expect(line.unitPricePaise).toBe(41_000);
    expect(line.appliedRule.type).toBe('NORMAL_PRICE');
  });

  it('ignores inactive rules', async () => {
    const { tmtProduct } = await createShopFixture();
    await createBulkDiscount({ isActive: false });
    const { token } = await loginAs('9876543210', AccountType.CUSTOMER);

    const line = await addItem(token, tmtProduct.id, 10);

    expect(line.unitPricePaise).toBe(6850);
    expect(line.appliedRule.type).toBe('NORMAL_PRICE');
  });

  it('prefers the product-specific bulk discount over a shop-wide one', async () => {
    const { tmtProduct } = await createShopFixture();
    await createBulkDiscount({ name: 'Shop-wide 3%', minQuantity: 10, discountBps: 300 });
    await createBulkDiscount({
      name: 'TMT 8%',
      productId: tmtProduct.id,
      minQuantity: 5,
      discountBps: 800,
    });
    const { token } = await loginAs('9876543210', AccountType.CUSTOMER);

    const line = await addItem(token, tmtProduct.id, 10);

    // 8% off 6850 = 6302.
    expect(line.unitPricePaise).toBe(6302);
    expect(line.appliedRule.label).toBe('TMT 8%');
  });
});
