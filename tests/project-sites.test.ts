import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { API, api, auth, signUpOrLogin, validProjectSite } from './helpers';

const PHONE = '9876500030';
const OTHER_PHONE = '9876500031';

async function loginContractor(phone = PHONE) {
  return signUpOrLogin(phone, { accountType: AccountType.CONTRACTOR, name: 'Suresh Patil' });
}

describe('project sites', () => {
  it('creates a site with coordinates and pincode', async () => {
    const { token } = await loginContractor();

    const response = await api()
      .post(`${API}/me/project-sites`)
      .set(auth(token))
      .send(validProjectSite);

    expect(response.status).toBe(201);
    expect(response.body.data.siteName).toBe('Green Meadows Phase 2');
    expect(response.body.data.pincode).toBe('411045');
    expect(response.body.data.latitude).toBeCloseTo(18.559, 3);
    expect(response.body.data.longitude).toBeCloseTo(73.7868, 3);
  });

  it('lists, updates and deletes my sites', async () => {
    const { token } = await loginContractor();
    const created = await api()
      .post(`${API}/me/project-sites`)
      .set(auth(token))
      .send(validProjectSite);
    const id = created.body.data.id as string;

    const list = await api().get(`${API}/me/project-sites`).set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const updated = await api()
      .patch(`${API}/me/project-sites/${id}`)
      .set(auth(token))
      .send({ siteName: 'Green Meadows Phase 3', pincode: '411046' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.siteName).toBe('Green Meadows Phase 3');

    await api().delete(`${API}/me/project-sites/${id}`).set(auth(token)).expect(204);

    const empty = await api().get(`${API}/me/project-sites`).set(auth(token));
    expect(empty.body.data).toHaveLength(0);
  });

  it('keeps project sites private to their owner', async () => {
    const { token } = await loginContractor();
    const { token: otherToken } = await loginContractor(OTHER_PHONE);

    const created = await api()
      .post(`${API}/me/project-sites`)
      .set(auth(token))
      .send(validProjectSite);
    const id = created.body.data.id as string;

    const read = await api().get(`${API}/me/project-sites/${id}`).set(auth(otherToken));
    expect(read.status).toBe(404);

    const remove = await api().delete(`${API}/me/project-sites/${id}`).set(auth(otherToken));
    expect(remove.status).toBe(404);
  });

  it('validates required fields', async () => {
    const { token } = await loginContractor();

    const response = await api()
      .post(`${API}/me/project-sites`)
      .set(auth(token))
      .send({ ...validProjectSite, pincode: 'abc' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
