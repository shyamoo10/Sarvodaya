import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { requestOtpSchema, verifyOtpSchema, type RequestOtpInput, type VerifyOtpInput } from './auth.schemas';
import { requestOtp, verifyOtp } from './auth.service';
import { serializeUser } from '../users/user.serializer';

export const authRouter = Router();

authRouter.post(
  '/otp/request',
  validate(requestOtpSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as RequestOtpInput;
    const result = await requestOtp({
      phone: body.phone,
      accountType: body.accountType,
      ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
    });
    sendSuccess(res, result, 200);
  }),
);

authRouter.post(
  '/otp/verify',
  validate(verifyOtpSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as VerifyOtpInput;
    const result = await verifyOtp({
      phone: body.phone,
      otp: body.otp,
      accountType: body.accountType,
      name: body.name,
      companyName: body.companyName,
      gstNumber: body.gstNumber,
    });
    sendSuccess(res, result, 200);
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id } });
    if (!user) {
      throw new ApiError(401, ErrorCode.UNAUTHORIZED, 'Account no longer exists');
    }
    sendSuccess(res, serializeUser(user), 200);
  }),
);
