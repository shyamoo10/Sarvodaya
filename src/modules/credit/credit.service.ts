import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError, parsePagination } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import type {
  CreditTermsCreateInput,
  CreditTermsQuery,
  CreditTermsUpdateInput,
} from './credit.schemas';

/**
 * Pay-later for contractors.
 *
 * The shop decides who gets credit, how much and for how many days. Checkout only
 * allows CREDIT while terms exist and are enabled, and never lets the outstanding
 * balance pass the limit.
 */

/** Total unpaid amount across the contractor's credit orders, in paise. */
export async function outstandingCreditPaise(contractorId: string): Promise<number> {
  const rows = await prisma.order.findMany({
    where: {
      userId: contractorId,
      paymentMethod: 'CREDIT',
      status: { not: 'CANCELLED' },
    },
    select: { grandTotalPaise: true, amountPaidPaise: true },
  });

  return rows.reduce((total, row) => total + Math.max(0, row.grandTotalPaise - row.amountPaidPaise), 0);
}

const creditInclude = {
  contractor: { select: { id: true, name: true, phone: true, companyName: true } },
} satisfies Prisma.CreditTermsInclude;

export async function listCreditTerms(query: CreditTermsQuery) {
  const { page, limit, skip } = parsePagination(query);
  const where: Prisma.CreditTermsWhereInput = {
    ...(query.isEnabled === undefined ? {} : { isEnabled: query.isEnabled === 'true' }),
    ...(query.search
      ? {
          contractor: {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { phone: { contains: query.search } },
              { companyName: { contains: query.search, mode: 'insensitive' as const } },
            ],
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.creditTerms.count({ where }),
    prisma.creditTerms.findMany({
      where,
      include: creditInclude,
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return { items, total, page, limit };
}

export async function getCreditTerms(id: string) {
  const terms = await prisma.creditTerms.findUnique({ where: { id }, include: creditInclude });
  if (!terms) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Credit terms not found');
  }
  return terms;
}

export async function createCreditTerms(input: CreditTermsCreateInput) {
  const contractor = await prisma.user.findUnique({
    where: { id: input.contractorId },
    select: { id: true, accountType: true },
  });
  if (!contractor || contractor.accountType !== 'CONTRACTOR') {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Contractor not found');
  }

  try {
    return await prisma.creditTerms.create({
      data: {
        contractorId: input.contractorId,
        isEnabled: input.isEnabled,
        creditLimitPaise: input.creditLimitPaise ?? null,
        paymentTermDays: input.paymentTermDays,
        notes: input.notes ?? null,
      },
      include: creditInclude,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(
        409,
        ErrorCode.CREDIT_TERMS_EXIST,
        'This contractor already has credit terms; edit them instead',
      );
    }
    throw error;
  }
}

export async function updateCreditTerms(id: string, input: CreditTermsUpdateInput) {
  await getCreditTerms(id);
  return prisma.creditTerms.update({
    where: { id },
    data: {
      ...(input.isEnabled === undefined ? {} : { isEnabled: input.isEnabled }),
      ...(input.creditLimitPaise === undefined
        ? {}
        : { creditLimitPaise: input.creditLimitPaise }),
      ...(input.paymentTermDays === undefined ? {} : { paymentTermDays: input.paymentTermDays }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    },
    include: creditInclude,
  });
}

export async function deleteCreditTerms(id: string): Promise<void> {
  await getCreditTerms(id);
  await prisma.creditTerms.delete({ where: { id } });
}

type CreditTermsRow = Prisma.CreditTermsGetPayload<{ include: typeof creditInclude }>;

/** The admin shape, with the contractor's current outstanding balance. */
export async function serializeCreditTerms(terms: CreditTermsRow) {
  const outstandingPaise = await outstandingCreditPaise(terms.contractorId);
  return {
    id: terms.id,
    contractorId: terms.contractorId,
    contractor: {
      id: terms.contractor.id,
      name: terms.contractor.name,
      phone: terms.contractor.phone,
      companyName: terms.contractor.companyName,
    },
    isEnabled: terms.isEnabled,
    creditLimitPaise: terms.creditLimitPaise,
    paymentTermDays: terms.paymentTermDays,
    notes: terms.notes,
    outstandingPaise,
    availablePaise:
      terms.creditLimitPaise === null
        ? null
        : Math.max(0, terms.creditLimitPaise - outstandingPaise),
    createdAt: terms.createdAt.toISOString(),
    updatedAt: terms.updatedAt.toISOString(),
  };
}
