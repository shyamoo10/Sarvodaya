import type { PrismaClient } from '@prisma/client';

/**
 * Sample pay-later terms for the seeded contractor, so the app can be tried with
 * credit from the start. Idempotent: an existing row (whatever the owner changed
 * it to) is never overwritten.
 */
export async function seedCreditTerms(prisma: PrismaClient): Promise<string> {
  const contractor = await prisma.user.findUnique({
    where: { phone: '9123456780' },
    select: { id: true },
  });

  if (!contractor) {
    return 'no sample contractor, credit terms skipped';
  }

  const existing = await prisma.creditTerms.findUnique({
    where: { contractorId: contractor.id },
    select: { id: true },
  });
  if (existing) {
    return 'credit terms already present';
  }

  await prisma.creditTerms.create({
    data: {
      contractorId: contractor.id,
      isEnabled: true,
      creditLimitPaise: 20_000_000,
      paymentTermDays: 30,
      notes: 'Sample terms for the seed contractor; the owner can change them any time',
    },
  });

  return 'credit terms created';
}
