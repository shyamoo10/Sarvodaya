import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { API, api, auth, signUpOrLogin } from './helpers';

const PHONE = '9876500010';

describe('GET /me', () => {
  it('returns the logged-in user profile', async () => {
    const { token } = await signUpOrLogin(PHONE, {
      accountType: AccountType.CUSTOMER,
      name: 'Ramesh Kumar',
    });

    const response = await api().get(`${API}/me`).set(auth(token));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      phone: PHONE,
      name: 'Ramesh Kumar',
      accountType: 'CUSTOMER',
      companyName: null,
      gstNumber: null,
      isBlocked: false,
    });
  });

  it('requires authentication', async () => {
    const response = await api().get(`${API}/me`);
    expect(response.status).toBe(401);
  });
});

describe('PATCH /me', () => {
  it('updates name, company name and GST number', async () => {
    const { token } = await signUpOrLogin(PHONE, {
      accountType: AccountType.CONTRACTOR,
      name: 'Suresh Patil',
    });

    const response = await api()
      .patch(`${API}/me`)
      .set(auth(token))
      .send({
        name: 'Suresh R. Patil',
        companyName: 'Patil Constructions',
        gstNumber: '27abcde1234f1z5',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Suresh R. Patil');
    expect(response.body.data.companyName).toBe('Patil Constructions');
    expect(response.body.data.gstNumber).toBe('27ABCDE1234F1Z5');
  });

  it('clears optional company details when sent as null or empty string', async () => {
    const { token } = await signUpOrLogin(PHONE, {
      accountType: AccountType.CONTRACTOR,
      name: 'Suresh Patil',
      companyName: 'Patil Constructions',
      gstNumber: '27ABCDE1234F1Z5',
    });

    const response = await api()
      .patch(`${API}/me`)
      .set(auth(token))
      .send({ companyName: '', gstNumber: null });

    expect(response.status).toBe(200);
    expect(response.body.data.companyName).toBeNull();
    expect(response.body.data.gstNumber).toBeNull();
  });

  it('rejects an invalid GST number', async () => {
    const { token } = await signUpOrLogin(PHONE, {
      accountType: AccountType.CONTRACTOR,
      name: 'Suresh Patil',
    });

    const response = await api()
      .patch(`${API}/me`)
      .set(auth(token))
      .send({ gstNumber: 'NOT-A-GST' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('gstNumber');
  });

  it('rejects a too-short name', async () => {
    const { token } = await signUpOrLogin(PHONE, {
      accountType: AccountType.CUSTOMER,
      name: 'Ramesh Kumar',
    });

    const response = await api().patch(`${API}/me`).set(auth(token)).send({ name: 'R' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('forbids changing the account type', async () => {
    const { token } = await signUpOrLogin(PHONE, {
      accountType: AccountType.CUSTOMER,
      name: 'Ramesh Kumar',
    });

    const response = await api()
      .patch(`${API}/me`)
      .set(auth(token))
      .send({ accountType: 'CONTRACTOR' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACCOUNT_TYPE_IMMUTABLE');
  });

  it('ignores attempts to change the phone number', async () => {
    const { token } = await signUpOrLogin(PHONE, {
      accountType: AccountType.CUSTOMER,
      name: 'Ramesh Kumar',
    });

    const response = await api()
      .patch(`${API}/me`)
      .set(auth(token))
      .send({ phone: '9000000000', name: 'Ramesh K.' });

    expect(response.status).toBe(200);
    expect(response.body.data.phone).toBe(PHONE);
  });
});
