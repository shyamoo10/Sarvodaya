import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { API, api, auth, createAdmin, createCustomer, signUpOrLogin, TEST_OTP } from './helpers';
import { prisma } from '../src/lib/prisma';

const ADMIN_PHONE = '9999999999';
const CUSTOMER_PHONE = '9876500040';

async function loginAdmin() {
  await createAdmin(ADMIN_PHONE);
  return signUpOrLogin(ADMIN_PHONE);
}

describe('admin user management', () => {
  it('rejects non-admin users', async () => {
    const { token } = await signUpOrLogin(CUSTOMER_PHONE, {
      accountType: AccountType.CUSTOMER,
      name: 'Ramesh Kumar',
    });

    const response = await api().get(`${API}/admin/users`).set(auth(token));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('lets the seeded admin log in and list users with pagination meta', async () => {
    const { token } = await loginAdmin();
    await createCustomer(CUSTOMER_PHONE);

    const response = await api().get(`${API}/admin/users`).set(auth(token));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.meta).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(response.body.data).toHaveLength(2);
  });

  it('filters users by search, account type and block status', async () => {
    const { token } = await loginAdmin();
    await createCustomer(CUSTOMER_PHONE);
    const blocked = await createCustomer('9876500041', 'Blocked Person');
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });

    const bySearch = await api()
      .get(`${API}/admin/users?search=9876500040`)
      .set(auth(token));
    expect(bySearch.body.data).toHaveLength(1);
    expect(bySearch.body.data[0].phone).toBe(CUSTOMER_PHONE);

    const byBlocked = await api()
      .get(`${API}/admin/users?isBlocked=true`)
      .set(auth(token));
    expect(byBlocked.body.data).toHaveLength(1);
    expect(byBlocked.body.data[0].phone).toBe('9876500041');

    const byType = await api()
      .get(`${API}/admin/users?accountType=ADMIN`)
      .set(auth(token));
    expect(byType.body.data).toHaveLength(1);
  });

  it('blocks a customer: login and existing tokens stop working', async () => {
    const { token: adminToken } = await loginAdmin();
    const { token: customerToken, user } = await signUpOrLogin(CUSTOMER_PHONE, {
      accountType: AccountType.CUSTOMER,
      name: 'Ramesh Kumar',
    });

    const blocked = await api()
      .post(`${API}/admin/users/${user.id as string}/block`)
      .set(auth(adminToken))
      .send({ reason: 'Repeated payment failures' });

    expect(blocked.status).toBe(200);
    expect(blocked.body.data.isBlocked).toBe(true);
    expect(blocked.body.data.blockedReason).toBe('Repeated payment failures');

    // The token the customer already holds is rejected immediately.
    const me = await api().get(`${API}/me`).set(auth(customerToken));
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe('USER_BLOCKED');

    // ... and no new OTP is issued.
    const otp = await api().post(`${API}/auth/otp/request`).send({ phone: CUSTOMER_PHONE });
    expect(otp.status).toBe(403);
    expect(otp.body.error.code).toBe('USER_BLOCKED');
  });

  it('unblocks a customer so they can log in again', async () => {
    const { token: adminToken } = await loginAdmin();
    const customer = await createCustomer(CUSTOMER_PHONE);
    await prisma.user.update({
      where: { id: customer.id },
      data: { isBlocked: true, blockedAt: new Date(), blockedReason: 'Test' },
    });

    const unblocked = await api()
      .post(`${API}/admin/users/${customer.id}/unblock`)
      .set(auth(adminToken));

    expect(unblocked.status).toBe(200);
    expect(unblocked.body.data.isBlocked).toBe(false);
    expect(unblocked.body.data.blockedReason).toBeNull();

    await api().post(`${API}/auth/otp/request`).send({ phone: CUSTOMER_PHONE }).expect(200);
    const login = await api()
      .post(`${API}/auth/otp/verify`)
      .send({ phone: CUSTOMER_PHONE, otp: TEST_OTP });
    expect(login.status).toBe(200);
  });

  it('refuses to block an admin or yourself', async () => {
    const { token: adminToken, user: admin } = await loginAdmin();

    const self = await api()
      .post(`${API}/admin/users/${admin.id as string}/block`)
      .set(auth(adminToken));
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_BLOCK_SELF');

    const secondAdmin = await prisma.user.create({
      data: {
        phone: '9999999998',
        name: 'Second Admin',
        accountType: AccountType.ADMIN,
      },
    });

    const otherAdmin = await api()
      .post(`${API}/admin/users/${secondAdmin.id}/block`)
      .set(auth(adminToken));
    expect(otherAdmin.status).toBe(403);
    expect(otherAdmin.body.error.code).toBe('CANNOT_BLOCK_ADMIN');
  });

  it('returns 404 for an unknown user', async () => {
    const { token } = await loginAdmin();

    const response = await api()
      .post(`${API}/admin/users/3f0f2a3e-8a6b-4f5c-9d1e-2b3c4d5e6f70/block`)
      .set(auth(token));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns a single user by id', async () => {
    const { token } = await loginAdmin();
    const customer = await createCustomer(CUSTOMER_PHONE);

    const response = await api().get(`${API}/admin/users/${customer.id}`).set(auth(token));

    expect(response.status).toBe(200);
    expect(response.body.data.phone).toBe(CUSTOMER_PHONE);
    expect(response.body.data.blockedAt).toBeNull();
  });
});
