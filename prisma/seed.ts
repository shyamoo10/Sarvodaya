import 'dotenv/config';
import { AccountType, PrismaClient } from '@prisma/client';
import { normalizePhone } from '../src/lib/phone';

const prisma = new PrismaClient();

/**
 * Seed script.
 *
 * The ONLY way an ADMIN account is created. Customers and contractors sign
 * themselves up through the OTP flow; they can never choose ADMIN.
 *
 * Safe to run repeatedly: it upserts by phone number.
 */
async function main(): Promise<void> {
  const adminPhone = normalizePhone(process.env.SEED_ADMIN_PHONE ?? '9999999999');
  const adminName = process.env.SEED_ADMIN_NAME ?? 'Sarvodaya Admin';
  const adminCompany = process.env.SEED_ADMIN_COMPANY ?? 'Sarvodaya Hardware';

  const admin = await prisma.user.upsert({
    where: { phone: adminPhone },
    update: {
      accountType: AccountType.ADMIN,
      name: adminName,
      companyName: adminCompany,
      isBlocked: false,
      blockedAt: null,
      blockedReason: null,
    },
    create: {
      phone: adminPhone,
      accountType: AccountType.ADMIN,
      name: adminName,
      companyName: adminCompany,
    },
  });

  console.log(`Seeded admin: ${admin.phone} (${admin.name})`);

  if (process.env.SEED_SAMPLE_USERS !== 'false') {
    const customer = await prisma.user.upsert({
      where: { phone: '9876543210' },
      update: {},
      create: {
        phone: '9876543210',
        accountType: AccountType.CUSTOMER,
        name: 'Ramesh Kumar',
      },
    });

    const contractor = await prisma.user.upsert({
      where: { phone: '9123456780' },
      update: {},
      create: {
        phone: '9123456780',
        accountType: AccountType.CONTRACTOR,
        name: 'Suresh Patil',
        companyName: 'Patil Constructions',
        gstNumber: '27ABCDE1234F1Z5',
      },
    });

    const customerAddresses = await prisma.address.count({ where: { userId: customer.id } });
    if (customerAddresses === 0) {
      await prisma.address.create({
        data: {
          userId: customer.id,
          label: 'Home',
          contactName: 'Ramesh Kumar',
          contactPhone: '9876543210',
          line1: '12, Shivaji Nagar',
          landmark: 'Near Ganesh Temple',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411005',
          latitude: 18.5204,
          longitude: 73.8567,
          isDefault: true,
        },
      });
    }

    const contractorSites = await prisma.projectSite.count({ where: { userId: contractor.id } });
    if (contractorSites === 0) {
      await prisma.projectSite.create({
        data: {
          userId: contractor.id,
          siteName: 'Green Meadows Phase 2',
          contactName: 'Suresh Patil',
          contactPhone: '9123456780',
          line1: 'Survey No. 48, Baner Road',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411045',
          latitude: 18.559,
          longitude: 73.7868,
          notes: 'Gate passes required before 9 AM.',
        },
      });
    }

    console.log(`Seeded sample customer: ${customer.phone} and contractor: ${contractor.phone}`);
  }

  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
