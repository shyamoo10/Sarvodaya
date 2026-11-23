import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { API, api, auth, signUpOrLogin, validAddress } from './helpers';

const PHONE = '9876500020';
const OTHER_PHONE = '9876500021';

async function login(phone = PHONE) {
  return signUpOrLogin(phone, { accountType: AccountType.CUSTOMER, name: 'Ramesh Kumar' });
}

describe('addresses', () => {
  it('makes the first saved address the default', async () => {
    const { token } = await login();

    const response = await api()
      .post(`${API}/me/addresses`)
      .set(auth(token))
      .send(validAddress);

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBeTypeOf('string');
    expect(response.body.data.isDefault).toBe(true);
    expect(response.body.data.pincode).toBe('411005');
    expect(response.body.data.latitude).toBeCloseTo(18.5204, 4);
  });

  it('moves the default flag when a new default is saved', async () => {
    const { token } = await login();

    const first = await api().post(`${API}/me/addresses`).set(auth(token)).send(validAddress);
    expect(first.body.data.isDefault).toBe(true);

    const second = await api()
      .post(`${API}/me/addresses`)
      .set(auth(token))
      .send({ ...validAddress, label: 'Shop', isDefault: true });

    expect(second.status).toBe(201);
    expect(second.body.data.isDefault).toBe(true);

    const list = await api().get(`${API}/me/addresses`).set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].label).toBe('Shop');
    expect(list.body.data.filter((address: { isDefault: boolean }) => address.isDefault)).toHaveLength(1);
  });

  it('updates and deletes an address', async () => {
    const { token } = await login();
    const created = await api().post(`${API}/me/addresses`).set(auth(token)).send(validAddress);
    const id = created.body.data.id as string;

    const updated = await api()
      .patch(`${API}/me/addresses/${id}`)
      .set(auth(token))
      .send({ line1: '45, FC Road', city: 'Pune', pincode: '411004' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.line1).toBe('45, FC Road');
    expect(updated.body.data.pincode).toBe('411004');

    const deleted = await api().delete(`${API}/me/addresses/${id}`).set(auth(token));
    expect(deleted.status).toBe(204);

    const list = await api().get(`${API}/me/addresses`).set(auth(token));
    expect(list.body.data).toHaveLength(0);
  });

  it('promotes another address to default when the default is deleted', async () => {
    const { token } = await login();
    const first = await api().post(`${API}/me/addresses`).set(auth(token)).send(validAddress);
    await api()
      .post(`${API}/me/addresses`)
      .set(auth(token))
      .send({ ...validAddress, label: 'Shop' });

    await api().delete(`${API}/me/addresses/${first.body.data.id}`).set(auth(token)).expect(204);

    const list = await api().get(`${API}/me/addresses`).set(auth(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].isDefault).toBe(true);
  });

  it('keeps addresses private to their owner', async () => {
    const { token } = await login();
    const { token: otherToken } = await login(OTHER_PHONE);

    const created = await api().post(`${API}/me/addresses`).set(auth(token)).send(validAddress);
    const id = created.body.data.id as string;

    const read = await api().get(`${API}/me/addresses/${id}`).set(auth(otherToken));
    expect(read.status).toBe(404);
    expect(read.body.error.code).toBe('NOT_FOUND');

    const update = await api()
      .patch(`${API}/me/addresses/${id}`)
      .set(auth(otherToken))
      .send({ city: 'Mumbai' });
    expect(update.status).toBe(404);

    const remove = await api().delete(`${API}/me/addresses/${id}`).set(auth(otherToken));
    expect(remove.status).toBe(404);
  });

  it('validates pincode, coordinates and required fields', async () => {
    const { token } = await login();

    const badPincode = await api()
      .post(`${API}/me/addresses`)
      .set(auth(token))
      .send({ ...validAddress, pincode: '41' });
    expect(badPincode.status).toBe(400);
    expect(badPincode.body.error.code).toBe('VALIDATION_ERROR');

    const badLatitude = await api()
      .post(`${API}/me/addresses`)
      .set(auth(token))
      .send({ ...validAddress, latitude: 120 });
    expect(badLatitude.status).toBe(400);

    const latWithoutLng = await api()
      .post(`${API}/me/addresses`)
      .set(auth(token))
      .send({ ...validAddress, longitude: undefined });
    expect(latWithoutLng.status).toBe(400);
    expect(latWithoutLng.body.error.code).toBe('VALIDATION_ERROR');

    const missingCity = await api()
      .post(`${API}/me/addresses`)
      .set(auth(token))
      .send({ ...validAddress, city: undefined });
    expect(missingCity.status).toBe(400);
  });

  it('rejects an unknown address id format', async () => {
    const { token } = await login();
    const response = await api().get(`${API}/me/addresses/not-a-uuid`).set(auth(token));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
