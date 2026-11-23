import type { PrismaClient } from '@prisma/client';

/**
 * Pricing, delivery slabs and serviceable pincodes.
 *
 * Idempotent and non-destructive: an existing settings row is never overwritten,
 * so amounts changed by the owner survive a re-run. Slabs are only created when
 * none exist yet; rules and pincodes are matched by their natural key.
 */
export async function seedPricingAndDelivery(prisma: PrismaClient): Promise<string> {
  await prisma.shopSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      shopLatitude: 18.5204,
      shopLongitude: 73.8567,
      // Rs 2,000 minimum order, Rs 100 charge below it.
      minOrderAmountPaise: 200_000,
      minOrderChargePaise: 10_000,
      // Free delivery above Rs 15,000 or within 3 km.
      freeDeliveryAbovePaise: 1_500_000,
      freeDeliveryRadiusKm: 3,
    },
  });

  if ((await prisma.distanceSlab.count()) === 0) {
    await prisma.distanceSlab.createMany({
      data: [
        { fromKm: 0, toKm: 5, chargePaise: 10_000 },
        { fromKm: 5, toKm: 15, chargePaise: 25_000 },
        { fromKm: 15, toKm: 30, chargePaise: 50_000 },
      ],
    });
  }

  const pincodes = [
    { pincode: '411001', areaName: 'Camp', city: 'Pune', latitude: 18.5122, longitude: 73.8776 },
    { pincode: '411004', areaName: 'Deccan Gymkhana', city: 'Pune', latitude: 18.5147, longitude: 73.8412 },
    { pincode: '411005', areaName: 'Shivaji Nagar', city: 'Pune', latitude: 18.5308, longitude: 73.8478 },
    { pincode: '411038', areaName: 'Kothrud', city: 'Pune', latitude: 18.5074, longitude: 73.8077 },
    { pincode: '411045', areaName: 'Baner', city: 'Pune', latitude: 18.559, longitude: 73.7868 },
    { pincode: '411057', areaName: 'Hinjewadi', city: 'Pune', latitude: 18.5913, longitude: 73.7389 },
  ];

  for (const pincode of pincodes) {
    await prisma.serviceablePincode.upsert({
      where: { pincode: pincode.pincode },
      update: {},
      create: pincode,
    });
  }

  const cement = await prisma.category.findUnique({ where: { slug: 'cement' } });
  const paint = await prisma.category.findUnique({ where: { slug: 'paint' } });

  const contractorRules = [
    { name: 'Cement contractor discount', categoryId: cement?.id ?? null, discountBps: 500 },
    { name: 'Paint contractor discount', categoryId: paint?.id ?? null, discountBps: 300 },
  ];
  for (const rule of contractorRules) {
    const existing = await prisma.contractorRule.findUnique({ where: { name: rule.name } });
    if (!existing) await prisma.contractorRule.create({ data: rule });
  }

  const bulkDiscounts = [
    { name: 'Buy 10 or more - 3% off', categoryId: null, minQuantity: 10, discountBps: 300 },
    {
      name: 'Cement bulk - 50 bags or more',
      categoryId: cement?.id ?? null,
      minQuantity: 50,
      discountBps: 500,
    },
  ];
  for (const discount of bulkDiscounts) {
    const existing = await prisma.bulkDiscount.findUnique({ where: { name: discount.name } });
    if (!existing) await prisma.bulkDiscount.create({ data: discount });
  }

  const contractor = await prisma.user.findUnique({ where: { phone: '9123456780' } });
  const tmtBar = await prisma.product.findUnique({ where: { sku: 'STL-TMT-008' } });
  if (contractor && tmtBar) {
    await prisma.contractorPrice.upsert({
      where: {
        contractorId_productId: { contractorId: contractor.id, productId: tmtBar.id },
      },
      update: {},
      create: {
        contractorId: contractor.id,
        productId: tmtBar.id,
        pricePaise: 6_600,
      },
    });
  }

  return `settings, ${pincodes.length} pincodes, delivery slabs, contractor and bulk rules`;
}
