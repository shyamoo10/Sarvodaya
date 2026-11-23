import type { Express } from 'express';
import request from 'supertest';
import { AccountType } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

export const app: Express = createApp();
export const TEST_OTP = '123456';
export const API = '/api/v1';

export const api = (): ReturnType<typeof request> => request(app);

type SignUpOptions = {
  accountType?: AccountType;
  name?: string;
  companyName?: string;
  gstNumber?: string;
};

/** Requests and verifies an OTP. On a new phone this creates the account. */
export async function signUpOrLogin(
  phone: string,
  options: SignUpOptions = {},
): Promise<{ token: string; user: Record<string, unknown> }> {
  const otpResponse = await api()
    .post(`${API}/auth/otp/request`)
    .send({ phone, ...(options.accountType ? { accountType: options.accountType } : {}) });

  if (otpResponse.status !== 200) {
    throw new Error(`OTP request failed: ${otpResponse.status} ${JSON.stringify(otpResponse.body)}`);
  }

  const verifyResponse = await api()
    .post(`${API}/auth/otp/verify`)
    .send({
      phone,
      otp: TEST_OTP,
      accountType: options.accountType,
      name: options.name,
      companyName: options.companyName,
      gstNumber: options.gstNumber,
    });

  if (verifyResponse.status !== 200) {
    throw new Error(
      `OTP verify failed: ${verifyResponse.status} ${JSON.stringify(verifyResponse.body)}`,
    );
  }

  return {
    token: verifyResponse.body.data.accessToken as string,
    user: verifyResponse.body.data.user as Record<string, unknown>,
  };
}

export async function createAdmin(phone = '9999999999') {
  return prisma.user.create({
    data: {
      phone,
      name: 'Shop Owner',
      accountType: AccountType.ADMIN,
      companyName: 'Sarvodaya Hardware',
    },
  });
}

export async function createCustomer(phone = '9876543210', name = 'Ramesh Kumar') {
  return prisma.user.create({
    data: { phone, name, accountType: AccountType.CUSTOMER },
  });
}

export function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export const validAddress = {
  label: 'Home',
  contactName: 'Ramesh Kumar',
  contactPhone: '9876543210',
  line1: '12, Shivaji Nagar',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411005',
  latitude: 18.5204,
  longitude: 73.8567,
};

export const validProjectSite = {
  siteName: 'Green Meadows Phase 2',
  contactName: 'Suresh Patil',
  contactPhone: '9123456780',
  line1: 'Survey No. 48, Baner Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411045',
  latitude: 18.559,
  longitude: 73.7868,
  notes: 'Gate pass needed',
};
