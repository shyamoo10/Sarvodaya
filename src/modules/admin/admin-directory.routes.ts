import { Router } from 'express';
import { Prisma, type AccountType } from '@prisma/client';
import { asyncHandler, sendSuccess, parsePagination } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { directoryQuerySchema, type DirectoryQuery } from './admin-directory.schemas';

export const adminDirectoryRouter = Router();

adminDirectoryRouter.use(requireAuth, requireAdmin);

/**
 * One page of customers or contractors, with what the shop actually needs to see:
 * how much they have bought, when they last ordered, and — for contractors — their
 * credit limit and outstanding pay-later balance.
 */
async function listAccounts(accountType: AccountType, query: DirectoryQuery) {
  const { page, limit, skip } = parsePagination(query);

  const where: Prisma.UserWhereInput = {
    accountType,
    ...(query.isBlocked === undefined ? {} : { isBlocked: query.isBlocked === 'true' }),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { phone: { contains: query.search } },
            { companyName: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        phone: true,
        companyName: true,
        gstNumber: true,
        isBlocked: true,
        createdAt: true,
        creditTerms: { select: { isEnabled: true, creditLimitPaise: true, paymentTermDays: true } },
      },
    }),
  ]);

  const ids = users.map((user) => user.id);

  const [orderTotals, creditTotals] = await Promise.all([
    prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
      _sum: { grandTotalPaise: true, amountPaidPaise: true },
      _max: { placedAt: true },
    }),
    accountType === 'CONTRACTOR'
      ? prisma.order.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            status: { not: 'CANCELLED' },
            paymentMethod: 'CREDIT',
          },
          _sum: { grandTotalPaise: true, amountPaidPaise: true },
        })
      : Promise.resolve([]),
  ]);

  const ordersByUser = new Map(orderTotals.map((row) => [row.userId, row]));
  const creditByUser = new Map(creditTotals.map((row) => [row.userId, row]));

  return {
    items: users.map((user) => {
      const orders = ordersByUser.get(user.id);
      const credit = creditByUser.get(user.id);
      const outstandingPaise = credit
        ? Math.max(
            0,
            (credit._sum.grandTotalPaise ?? 0) - (credit._sum.amountPaidPaise ?? 0),
          )
        : 0;

      return {
        id: user.id,
        name: user.name,
        phone: user.phone,
        companyName: user.companyName,
        gstNumber: user.gstNumber,
        isBlocked: user.isBlocked,
        createdAt: user.createdAt.toISOString(),
        orders: orders?._count._all ?? 0,
        totalPurchasesPaise: orders?._sum.grandTotalPaise ?? 0,
        amountPaidPaise: orders?._sum.amountPaidPaise ?? 0,
        lastOrderAt: orders?._max.placedAt?.toISOString() ?? null,
        ...(accountType === 'CONTRACTOR'
          ? {
              credit: user.creditTerms
                ? {
                    isEnabled: user.creditTerms.isEnabled,
                    creditLimitPaise: user.creditTerms.creditLimitPaise,
                    paymentTermDays: user.creditTerms.paymentTermDays,
                    outstandingPaise,
                  }
                : null,
            }
          : {}),
      };
    }),
    page,
    limit,
    total,
  };
}

async function respondWith(
  accountType: AccountType,
  query: DirectoryQuery,
): Promise<{ items: unknown[]; page: number; limit: number; total: number }> {
  return listAccounts(accountType, query);
}

adminDirectoryRouter.get(
  '/customers',
  validate(directoryQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as DirectoryQuery;
    const result = await respondWith('CUSTOMER', query);
    sendSuccess(res, result.items, 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

adminDirectoryRouter.get(
  '/contractors',
  validate(directoryQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as DirectoryQuery;
    const result = await respondWith('CONTRACTOR', query);
    sendSuccess(res, result.items, 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);
