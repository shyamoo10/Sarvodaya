import type { AccountType, User } from '@prisma/client';
import { env } from '../../config/env';
import { ApiError } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { prisma } from '../../lib/prisma';
import { signAccessToken } from '../../lib/jwt';
import { createOtp, checkOtp, otpStore } from './otp.store';
import { smsSender } from './sms.provider';
import { serializeUser } from '../users/user.serializer';

export type RequestOtpResult = {
  otpRequestId: string;
  phone: string;
  expiresAt: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  isNewUser: boolean;
  devOtp?: string;
};

export async function requestOtp(input: {
  phone: string;
  accountType?: AccountType;
  ip: string;
}): Promise<RequestOtpResult> {
  const existing = await prisma.user.findUnique({ where: { phone: input.phone } });

  // A blocked account must not receive OTPs at all.
  if (existing?.isBlocked) {
    throw new ApiError(
      403,
      ErrorCode.USER_BLOCKED,
      'This account has been blocked. Please contact the shop.',
    );
  }

  const cooldown = await otpStore.cooldownRemainingSeconds(input.phone);
  if (cooldown > 0) {
    throw new ApiError(
      429,
      ErrorCode.OTP_RESEND_TOO_SOON,
      `Please wait ${cooldown} seconds before requesting another OTP.`,
      { retryAfterSeconds: cooldown },
    );
  }

  const phoneCount = await otpStore.countRequest(
    otpStore.counterKeys.phone(input.phone),
    env.otp.windowSeconds,
  );
  const ipCount = await otpStore.countRequest(
    otpStore.counterKeys.ip(input.ip),
    env.otp.windowSeconds,
  );

  if (phoneCount > env.otp.requestsPerWindow || ipCount > env.otp.requestsPerIpPerWindow) {
    throw new ApiError(
      429,
      ErrorCode.OTP_RATE_LIMITED,
      'Too many OTP requests. Please try again later.',
      { retryAfterSeconds: env.otp.windowSeconds },
    );
  }

  const { otp, otpRequestId, expiresAt } = await createOtp(
    input.phone,
    input.accountType ?? null,
  );
  await otpStore.startCooldown(input.phone, env.otp.resendCooldownSeconds);
  await smsSender.sendOtp(input.phone, otp);

  return {
    otpRequestId,
    phone: input.phone,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: env.otp.ttlSeconds,
    resendAfterSeconds: env.otp.resendCooldownSeconds,
    isNewUser: !existing,
    ...(env.otp.fixedOtpEnabled ? { devOtp: otp } : {}),
  };
}

export type VerifyOtpResult = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  user: ReturnType<typeof serializeUser>;
  isNewUser: boolean;
};

export async function verifyOtp(input: {
  phone: string;
  otp: string;
  accountType?: AccountType;
  name?: string;
  companyName?: string;
  gstNumber?: string;
}): Promise<VerifyOtpResult> {
  const existing = await prisma.user.findUnique({ where: { phone: input.phone } });

  if (existing?.isBlocked) {
    throw new ApiError(
      403,
      ErrorCode.USER_BLOCKED,
      'This account has been blocked. Please contact the shop.',
    );
  }

  const result = await checkOtp(input.phone, input.otp);

  if (result.status === 'missing') {
    throw new ApiError(400, ErrorCode.OTP_EXPIRED, 'This OTP has expired. Request a new one.');
  }
  if (result.status === 'blocked') {
    throw new ApiError(
      429,
      ErrorCode.OTP_MAX_ATTEMPTS,
      'Too many incorrect attempts. Request a new OTP.',
    );
  }
  if (result.status === 'invalid') {
    throw new ApiError(400, ErrorCode.OTP_INVALID, 'Incorrect OTP', {
      remainingAttempts: result.remainingAttempts,
    });
  }

  await otpStore.remove(input.phone);

  let user: User;
  let isNewUser = false;

  if (existing) {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date() },
    });
  } else {
    if (!input.accountType) {
      throw new ApiError(
        400,
        ErrorCode.ACCOUNT_TYPE_REQUIRED,
        'accountType (CUSTOMER or CONTRACTOR) is required to create an account',
      );
    }
    if (input.accountType === 'ADMIN') {
      throw new ApiError(
        400,
        ErrorCode.ACCOUNT_TYPE_NOT_ALLOWED,
        'Admin accounts can only be created by the shop owner',
      );
    }
    if (!input.name) {
      throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
        { field: 'name', message: 'Name is required to create an account' },
      ]);
    }

    try {
      user = await prisma.user.create({
        data: {
          phone: input.phone,
          name: input.name,
          accountType: input.accountType,
          companyName: input.companyName ?? null,
          gstNumber: input.gstNumber ? input.gstNumber.toUpperCase() : null,
          lastLoginAt: new Date(),
        },
      });
      isNewUser = true;
    } catch (error) {
      // Another request created the same phone in between: treat it as a login.
      const raced = await prisma.user.findUnique({ where: { phone: input.phone } });
      if (!raced) throw error;
      user = await prisma.user.update({
        where: { id: raced.id },
        data: { lastLoginAt: new Date() },
      });
    }
  }

  if (user.isBlocked) {
    throw new ApiError(
      403,
      ErrorCode.USER_BLOCKED,
      'This account has been blocked. Please contact the shop.',
    );
  }

  return {
    accessToken: signAccessToken(user),
    tokenType: 'Bearer',
    expiresInSeconds: env.jwtExpiresInSeconds,
    user: serializeUser(user),
    isNewUser,
  };
}
