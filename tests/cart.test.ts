import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { api, API, auth } from './helpers';
import { createAddress, createShopFixture, loginAs } from './pricing-helpers';

const cartItemCount = (userId: string) =>
  prisma.cartItem.count({ where: { cart: { userId } } });

describe('cart', () => {
  it('starts empty and needs a signed-in account', async () => {
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);

    const response = await api().get(`${API}/cart`).set(auth(token));

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
    expect(response.body.data.itemTotalPaise).toBe(0);
    expect(response.body.data.grandTotalPaise).toBe(0);
    expect(response.body.data.delivery).toBeNull();
    expect(response.body.data.charges.map((charge: { code: string }) => charge.code)).toEqual([
      'ITEM_TOTAL',
      'MIN_ORDER_CHARGE',
      'DISTANCE_CHARGE',
    ]);
    expect(user.id).toBeTruthy();

    const anonymous = await api().get(`${API}/cart`);
    expect(anonymous.status).toBe(401);
  });

  it('stores the cart on the server so it survives an app restart', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);

    const added = await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 2 });
    expect(added.status).toBe(201);

    // Read straight from the database: nothing lives in the request or in memory.
    expect(await cartItemCount(user.id as string)).toBe(1);

    const response = await api().get(`${API}/cart`).set(auth(token));
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      productId: tmtProduct.id,
      quantity: 2,
      lineTotalPaise: 13_700,
    });
    expect(response.body.data.totalQuantity).toBe(2);
  });

  it('adds the same product to one line and updates or removes it', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);

    await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 1 });
    const second = await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 2 });

    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].quantity).toBe(3);
    expect(await cartItemCount(user.id as string)).toBe(1);

    const itemId = second.body.data.items[0].id as string;
    const updated = await api()
      .patch(`${API}/cart/items/${itemId}`)
      .set(auth(token))
      .send({ quantity: 5 });
    expect(updated.body.data.items[0].quantity).toBe(5);

    const removed = await api().delete(`${API}/cart/items/${itemId}`).set(auth(token));
    expect(removed.status).toBe(200);
    expect(removed.body.data.items).toEqual([]);

    await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 4 });
    const cleared = await api().delete(`${API}/cart`).set(auth(token));
    expect(cleared.body.data.items).toEqual([]);
    expect(await cartItemCount(user.id as string)).toBe(0);
  });

  it('rejects hidden products and impossible quantities', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token } = await loginAs('9876543210', AccountType.CUSTOMER);

    await prisma.product.update({ where: { id: tmtProduct.id }, data: { isActive: false } });
    const hidden = await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 1 });
    expect(hidden.status).toBe(404);

    await prisma.product.update({ where: { id: tmtProduct.id }, data: { isActive: true } });
    const zero = await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 0 });
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('adds the minimum order charge below the threshold, with the amount to avoid it', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);
    await createAddress(user.id as string, '411005', 18.5308, 73.8478);

    await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 2 });

    const response = await api().get(`${API}/cart`).set(auth(token));
    const data = response.body.data;

    expect(data.itemTotalPaise).toBe(13_700);
    expect(data.minOrder.isBelowThreshold).toBe(true);
    expect(data.charges[1]).toMatchObject({
      code: 'MIN_ORDER_CHARGE',
      amountPaise: 10_000,
      amountToAvoidChargePaise: 186_300,
    });
    // The address is about 1 km away, inside the 3 km free-delivery radius.
    expect(data.charges[2].amountPaise).toBe(0);
    expect(data.delivery).toMatchObject({ pincode: '411005', isFreeDelivery: true, freeDeliveryReason: 'WITHIN_RADIUS' });
    expect(data.grandTotalPaise).toBe(23_700);
  });

  it('charges the distance slab that covers the delivery address', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);
    await createAddress(user.id as string, '411045', 18.559, 73.7868);

    await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 2 });

    const data = (await api().get(`${API}/cart`).set(auth(token))).body.data;

    expect(data.delivery.distanceKm).toBeGreaterThan(5);
    expect(data.delivery.distanceKm).toBeLessThan(15);
    expect(data.charges[2].amountPaise).toBe(25_000);
    expect(data.grandTotalPaise).toBe(13_700 + 10_000 + 25_000);
  });

  it('waives delivery above the free-delivery amount', async () => {
    const { cementBag } = await createShopFixture();
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);
    await createAddress(user.id as string, '411057', 18.5913, 73.7389);

    await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: cementBag.id, quantity: 40 });

    const data = (await api().get(`${API}/cart`).set(auth(token))).body.data;

    expect(data.itemTotalPaise).toBe(1_640_000);
    expect(data.minOrder.isBelowThreshold).toBe(false);
    expect(data.charges[1].amountPaise).toBe(0);
    expect(data.charges[2].amountPaise).toBe(0);
    expect(data.delivery.freeDeliveryReason).toBe('ORDER_ABOVE_AMOUNT');
    expect(data.grandTotalPaise).toBe(1_640_000);
  });

  it('refuses a pincode the shop does not deliver to', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);
    await createAddress(user.id as string, '400001', 19.076, 72.8777);

    await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 1 });

    const response = await api().get(`${API}/cart`).set(auth(token));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PINCODE_NOT_SERVICEABLE');
    expect(response.body.error.message).toContain('400001');
  });

  it('refuses an address beyond the last delivery slab', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);
    await createAddress(user.id as string, '413001', 18.9, 74.2);

    await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 1 });

    const response = await api().get(`${API}/cart`).set(auth(token));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OUT_OF_DELIVERY_RANGE');
    expect(response.body.error.details.distanceKm).toBeGreaterThan(30);
  });

  it('asks for a delivery address when the account has none', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token } = await loginAs('9876543210', AccountType.CUSTOMER);

    const added = await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 1 });
    expect(added.status).toBe(201);

    const response = await api().get(`${API}/cart`).set(auth(token));

    // The cart is readable without an address; delivery just is not quoted yet.
    expect(response.status).toBe(200);
    expect(response.body.data.requiresDeliveryAddress).toBe(true);
    expect(response.body.data.delivery).toBeNull();
    expect(response.body.data.charges[2].amountPaise).toBe(0);
    expect(response.body.data.grandTotalPaise).toBe(16_850); // 6850 item + 10,000 minimum order charge
  });

  it('remembers the chosen address and lets a request override it', async () => {
    const { tmtProduct } = await createShopFixture();
    const { token, user } = await loginAs('9876543210', AccountType.CUSTOMER);
    const near = await createAddress(user.id as string, '411005', 18.5308, 73.8478);
    const far = await createAddress(user.id as string, '411045', 18.559, 73.7868);

    await api()
      .post(`${API}/cart/items`)
      .set(auth(token))
      .send({ productId: tmtProduct.id, quantity: 2 });

    const saved = await api()
      .put(`${API}/cart/delivery`)
      .set(auth(token))
      .send({ addressId: far.id });
    expect(saved.status).toBe(200);
    expect(saved.body.data.delivery.pincode).toBe('411045');
    expect(saved.body.data.charges[2].amountPaise).toBe(25_000);

    const overridden = await api()
      .get(`${API}/cart?addressId=${near.id}`)
      .set(auth(token));
    expect(overridden.body.data.delivery.pincode).toBe('411005');
    expect(overridden.body.data.charges[2].amountPaise).toBe(0);

    const foreign = await api()
      .put(`${API}/cart/delivery`)
      .set(auth(token))
      .send({ addressId: '00000000-0000-4000-8000-000000000000' });
    expect(foreign.status).toBe(404);
  });
});
