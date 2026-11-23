import type { RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { ApiError, asyncHandler } from '../lib/http';
import { ErrorCode } from '../config/error-codes';
import { verifyAccessToken } from '../lib/jwt';

/**
 * Verifies the bearer token and re-reads the user on every request so that a
 * block applied by the admin takes effect immediately, without waiting for the
 * token to expire.
 */
export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.header('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    throw new ApiError(401, ErrorCode.UNAUTHORIZED, 'Missing bearer token');
  }

  const token = header.slice(7).trim();
  let subject: string;
  try {
    subject = verifyAccessToken(token).sub as string;
  } catch {
    throw new ApiError(401, ErrorCode.UNAUTHORIZED, 'Invalid or expired token');
  }

  const user = await prisma.user.findUnique({
    where: { id: subject },
    select: { id: true, phone: true, accountType: true, isBlocked: true },
  });

  if (!user) {
    throw new ApiError(401, ErrorCode.UNAUTHORIZED, 'Account no longer exists');
  }
  if (user.isBlocked) {
    throw new ApiError(
      403,
      ErrorCode.USER_BLOCKED,
      'Your account has been blocked. Please contact the shop.',
    );
  }

  req.authUser = { id: user.id, phone: user.phone, accountType: user.accountType };
  next();
});

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.authUser?.accountType !== 'ADMIN') {
    next(new ApiError(403, ErrorCode.FORBIDDEN, 'Admin access is required'));
    return;
  }
  next();
};
