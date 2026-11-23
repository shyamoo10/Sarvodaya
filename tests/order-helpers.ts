import { AccountType } from '@prisma/client';
import { api, API, auth } from './helpers';
import { createAddress, createShopFixture, loginAs } from './pricing-helpers';

export async function addToCart(token: string, productId: string, quantity = 1) {
  const response = await api()
    .post(`${API}/cart/items`)
    .set(auth(token))
    .send({ productId, quantity });
  if (response.status !== 201) {
    throw new Error(`Adding to cart failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response;
}

export function placeOrder(
  token: string,
  body: Record<string, unknown> = {},
  idempotencyKey?: string,
) {
  const request = api().post(`${API}/orders`).set(auth(token));
  if (idempotencyKey) request.set('Idempotency-Key', idempotencyKey);
  return request.send(body);
}

/**
 * A shop fixture, a signed-in buyer with an address and one product in the cart:
 * the starting point for a checkout. The address in pincode 411005 is about 1 km
 * from the shop, so delivery is free inside the 3 km radius.
 */
export async function readyBuyer(options: {
  phone?: string;
  accountType?: AccountType;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  product?: 'tmt' | 'cement';
  quantity?: number;
} = {}) {
  const fixture = await createShopFixture();
  const { token, user } = await loginAs(
    options.phone ?? '9876543210',
    options.accountType ?? AccountType.CUSTOMER,
  );
  const address = await createAddress(
    user.id as string,
    options.pincode ?? '411005',
    options.latitude ?? 18.5308,
    options.longitude ?? 73.8478,
  );

  const product = options.product === 'cement' ? fixture.cementBag : fixture.tmtProduct;
  await addToCart(token, product.id, options.quantity ?? 2);

  return { ...fixture, token, user, address, product };
}
