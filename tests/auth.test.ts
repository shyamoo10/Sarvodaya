import { describe, expect, it } from 'vitest';
import { AccountType } from '@prisma/client';
import { API, TEST_OTP, api, auth, createCustomer, signUpOrLogin } from './helpers';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';
import { isFixedOtpEnabled } from '../src/config/env';

const PHONE = '9876500001';

describe('POST /auth/otp/request', () => {
  it('creates an OTP for a new phone and exposes the development OTP', async () => {
    const response = await api()
      .post(`${API}/auth/otp/request`)
      .send({ phone: '+91 98765 00001', accountType: 'CUSTOMER' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.phone).toBe(PHONE);
    expect(response.body.data.isNewUser).toBe(true);
    expect(response.body.data.expiresInSeconds).toBe(300);
    expect(response.body.data.devOtp).toBe(TEST_OTP);
    expect(response.headers['x-request-id']).toBeTruthy();

    // Only a keyed hash is stored, never the OTP itself.
    const stored = await redis.get(`otp:${PHONE}`);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(TEST_OTP);
  });

  it('rejects an invalid phone number with a stable validation code', async () => {
    const response = await api().post(`${API}/auth/otp/request`).send({ phone: '12345' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toBe('phone');
  });

  it('enforces the resend cooldown', async () => {
    await api().post(`${API}/auth/otp/request`).send({ phone: PHONE }).expect(200);

    const second = await api().post(`${API}/auth/otp/request`).send({ phone: PHONE });

    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    expect(second.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rate limits a phone that requests too many OTPs in the window', async () => {
    await redis.set(`otp:req:phone:${PHONE}`, '5');

    const response = await api().post(`${API}/auth/otp/request`).send({ phone: PHONE });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('OTP_RATE_LIMITED');
  });

  it('refuses to send an OTP to a blocked account', async () => {
    await prisma.user.create({
      data: { phone: PHONE, name: 'Blocked User', accountType: 'CUSTOMER', isBlocked: true },
    });

    const response = await api().post(`${API}/auth/otp/request`).send({ phone: PHONE });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('USER_BLOCKED');
  });
});

describe('POST /auth/otp/verify', () => {
  it('signs up a new customer and returns a working token', async () => {
    await api().post(`${API}/auth/otp/request`).send({ phone: PHONE }).expect(200);

    const response = await api()
      .post(`${API}/auth/otp/verify`)
      .send({ phone: PHONE, otp: TEST_OTP, accountType: 'CUSTOMER', name: 'Ramesh Kumar' });

    expect(response.status).toBe(200);
    const { accessToken, tokenType, user, isNewUser } = response.body.data;
    expect(accessToken).toBeTypeOf('string');
    expect(tokenType).toBe('Bearer');
    expect(isNewUser).toBe(true);
    expect(user.accountType).toBe('CUSTOMER');
    expect(user.name).toBe('Ramesh Kumar');
    expect(user.companyName).toBeNull();
    expect(user.gstNumber).toBeNull();

    const me = await api().get(`${API}/auth/me`).set(auth(accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.phone).toBe(PHONE);

    // The OTP is single use.
    const replay = await api()
      .post(`${API}/auth/otp/verify`)
      .send({ phone: PHONE, otp: TEST_OTP });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('OTP_EXPIRED');
  });

  it('signs up a contractor with optional company details', async () => {
    await api().post(`${API}/auth/otp/request`).send({ phone: PHONE }).expect(200);

    const response = await api().post(`${API}/auth/otp/verify`).send({
      phone: PHONE,
      otp: TEST_OTP,
      accountType: 'CONTRACTOR',
      name: 'Suresh Patil',
      companyName: 'Patil Constructions',
      gstNumber: '27abcde1234f1z5',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.user.accountType).toBe('CONTRACTOR');
    expect(response.body.data.user.companyName).toBe('Patil Constructions');
    expect(response.body.data.user.gstNumber).toBe('27ABCDE1234F1Z5');
  });

  it('requires an account type for a new phone number', async () => {
    await api().post(`${API}/auth/otp/request`).send({ phone: PHONE }).expect(200);

    const response = await api()
      .post(`${API}/auth/otp/verify`)
      .send({ phone: PHONE, otp: TEST_OTP, name: 'Ramesh Kumar' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ACCOUNT_TYPE_REQUIRED');
  });

  it('never lets a new account be created as ADMIN', async () => {
    await api().post(`${API}/auth/otp/request`).send({ phone: PHONE }).expect(200);

    const response = await api()
      .post(`${API}/auth/otp/verify`)
      .send({ phone: PHONE, otp: TEST_OTP, accountType: 'ADMIN', name: 'Fake Admin' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ACCOUNT_TYPE_NOT_ALLOWED');
    await expect(prisma.user.count({ where: { phone: PHONE } })).resolves.toBe(0);
  });

  it('requires a name for a new phone number', async () => {
    await api().post(`${API}/auth/otp/request`).send({ phone: PHONE }).expect(200);

    const response = await api()
      .post(`${API}/auth/otp/verify`)
      .send({ phone: PHONE, otp: TEST_OTP, accountType: 'CUSTOMER' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a wrong OTP and lowers the remaining attempts', async () => {
    await api().post(`${API}/auth/otp/request`).send({ phone: PHONE }).expect(200);

    const response = await api()
      .post(`${API}/auth/otp/verify`)
      .send({ phone: PHONE, otp: '000000', accountType: 'CUSTOMER', name: 'Ramesh Kumar' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OTP_INVALID');
    expect(response.body.error.details.remainingAttempts).toBe(4);
  });

  it('locks the OTP after too many wrong attempts', async () => {
    await api().post(`${API}/auth/otp/request`).send({ phone: PHONE }).expect(200);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wrong = await api()
        .post(`${API}/auth/otp/verify`)
        .send({ phone: PHONE, otp: '000000', accountType: 'CUSTOMER', name: 'Ramesh Kumar' });
      expect(wrong.body.error.code).toBe('OTP_INVALID');
    }

    const finalAttempt = await api().post(`${API}/auth/otp/verify`).send({
      phone: PHONE,
      otp: '000000',
      accountType: 'CUSTOMER',
      name: 'Ramesh Kumar',
    });

    expect(finalAttempt.status).toBe(429);
    expect(finalAttempt.body.error.code).toBe('OTP_MAX_ATTEMPTS');

    // Even the correct OTP no longer works.
    const correctAfterLock = await api().post(`${API}/auth/otp/verify`).send({
      phone: PHONE,
      otp: TEST_OTP,
      accountType: 'CUSTOMER',
      name: 'Ramesh Kumar',
    });
    expect(correctAfterLock.body.error.code).toBe('OTP_EXPIRED');
  });

  it('reports an expired (missing) OTP', async () => {
    const response = await api()
      .post(`${API}/auth/otp/verify`)
      .send({ phone: PHONE, otp: TEST_OTP, accountType: 'CUSTOMER', name: 'Ramesh Kumar' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OTP_EXPIRED');
  });

  it('does not accept an OTP issued for another phone number', async () => {
    const otherPhone = '9876500002';
    await api().post(`${API}/auth/otp/request`).send({ phone: otherPhone }).expect(200);

    const response = await api()
      .post(`${API}/auth/otp/verify`)
      .send({ phone: PHONE, otp: TEST_OTP, accountType: 'CUSTOMER', name: 'Ramesh Kumar' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OTP_EXPIRED');
  });

  it('logs an existing user back in and keeps their account type', async () => {
    await createCustomer(PHONE);

    const { user } = await signUpOrLogin(PHONE, {
      accountType: AccountType.CONTRACTOR,
      name: 'Ignored Name',
    });

    expect(user.accountType).toBe('CUSTOMER');
    expect(user.name).toBe('Ramesh Kumar');
    const stored = await prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });
    expect(stored.lastLoginAt).not.toBeNull();
  });

  it('refuses to log in a blocked account', async () => {
    const user = await createCustomer(PHONE);

    const otpResponse = await api().post(`${API}/auth/otp/request`).send({ phone: PHONE });
    expect(otpResponse.status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { isBlocked: true } });

    const response = await api().post(`${API}/auth/otp/verify`).send({ phone: PHONE, otp: TEST_OTP });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('USER_BLOCKED');
  });
});

describe('GET /auth/me', () => {
  it('requires a bearer token', async () => {
    const response = await api().get(`${API}/auth/me`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed token', async () => {
    const response = await api().get(`${API}/auth/me`).set(auth('not-a-token'));
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('unknown routes', () => {
  it('returns the error envelope with ROUTE_NOT_FOUND', async () => {
    const response = await api().get(`${API}/does-not-exist`);
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('fixed OTP safety', () => {
  it('is always disabled in production', () => {
    expect(isFixedOtpEnabled({ nodeEnv: 'production', enabled: true })).toBe(false);
    expect(isFixedOtpEnabled({ nodeEnv: 'development', enabled: true })).toBe(true);
    expect(isFixedOtpEnabled({ nodeEnv: 'test', enabled: false })).toBe(false);
  });
});
