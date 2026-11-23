import { Router } from 'express';
import { asyncHandler, sendSuccess, ApiError } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { ErrorCode } from '../../config/error-codes';
import { updateProfileSchema } from './user.schemas';
import { serializeUser } from './user.serializer';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.authUser!.id } });
    if (!user) throw new ApiError(401, ErrorCode.UNAUTHORIZED, 'Account no longer exists');
    sendSuccess(res, serializeUser(user), 200);
  }),
);

meRouter.patch(
  '/',
  validate(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      name?: string;
      companyName?: string | null;
      gstNumber?: string | null;
      accountType?: string;
    };

    if (body.accountType && body.accountType !== req.authUser!.accountType) {
      throw new ApiError(
        409,
        ErrorCode.ACCOUNT_TYPE_IMMUTABLE,
        'Account type cannot be changed after sign-up',
      );
    }

    const data: {
      name?: string;
      companyName?: string | null;
      gstNumber?: string | null;
    } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.companyName !== undefined) data.companyName = body.companyName;
    if (body.gstNumber !== undefined) data.gstNumber = body.gstNumber;

    const user = await prisma.user.update({
      where: { id: req.authUser!.id },
      data,
    });

    sendSuccess(res, serializeUser(user), 200);
  }),
);
