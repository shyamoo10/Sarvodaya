import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { asyncHandler, sendSuccess, ApiError, parsePagination } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { ErrorCode } from '../../config/error-codes';
import { listUsersQuerySchema, blockUserSchema } from './admin.schemas';
import { serializeAdminUser } from '../users/user.serializer';
import { idParamSchema } from '../users/user.schemas';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get(
  '/users',
  validate(listUsersQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as {
      search?: string;
      accountType?: Prisma.UserWhereInput['accountType'];
      isBlocked?: boolean;
      page?: string;
      limit?: string;
    };
    const { page, limit, skip } = parsePagination(query);

    const where: Prisma.UserWhereInput = {};
    if (query.accountType) where.accountType = query.accountType;
    if (query.isBlocked !== undefined) where.isBlocked = query.isBlocked;
    if (query.search) {
      const search = query.search;
      where.OR = [
        { phone: { contains: search } },
        { name: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    sendSuccess(res, users.map(serializeAdminUser), 200, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

adminRouter.get(
  '/users/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id as string } });
    if (!user) throw new ApiError(404, ErrorCode.NOT_FOUND, 'User not found');
    sendSuccess(res, serializeAdminUser(user), 200);
  }),
);

adminRouter.post(
  '/users/:id/block',
  validate(idParamSchema, 'params'),
  validate(blockUserSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    const { reason } = req.body as { reason?: string };

    if (id === req.authUser!.id) {
      throw new ApiError(400, ErrorCode.CANNOT_BLOCK_SELF, 'You cannot block your own account');
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, ErrorCode.NOT_FOUND, 'User not found');
    if (target.accountType === 'ADMIN') {
      throw new ApiError(403, ErrorCode.CANNOT_BLOCK_ADMIN, 'Admin accounts cannot be blocked');
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        isBlocked: true,
        blockedAt: new Date(),
        blockedReason: reason ?? null,
      },
    });

    sendSuccess(res, serializeAdminUser(user), 200);
  }),
);

adminRouter.post(
  '/users/:id/unblock',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, ErrorCode.NOT_FOUND, 'User not found');

    const user = await prisma.user.update({
      where: { id },
      data: { isBlocked: false, blockedAt: null, blockedReason: null },
    });

    sendSuccess(res, serializeAdminUser(user), 200);
  }),
);
