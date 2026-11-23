import type { AccountType } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { signUpOrLogin } from './helpers';

/** Shop at Shivaji Nagar, Pune. Distances below are measured from here. */
export const SHOP = { latitude: 18.5204, longitude: 73.8567 };

/**
 * A shop with two products (TMT steel per kg, cement per bag), the default
 * pricing settings, three distance slabs and four serviceable pincodes:
 *
 *  411005  ~1 km   inside the 3 km free-delivery radius
 *  411045  ~8 km   falls in the 5-15 km slab
 *  411057  ~14 km  also the 5-15 km slab, used for the free-above-amount test
 *  413001  ~55 km  beyond the last slab, so out of the delivery area
 */
export async function createShopFixture() {
  const steel = await prisma.category.create({
    data: { name: 'Steel', slug: 'steel', sortOrder: 1 },
  });
  const tmt = await prisma.category.create({
    data: { name: 'TMT Bars', slug: 'tmt-bars', parentId: steel.id },
  });
  const cement = await prisma.category.create({
    data: { name: 'Cement', slug: 'cement', sortOrder: 2 },
  });
  const opc = await prisma.category.create({
    data: { name: 'OPC Cement', slug: 'opc-cement', parentId: cement.id },
  });

  await prisma.shopSettings.create({
    data: {
      id: 'default',
      shopLatitude: SHOP.latitude,
      shopLongitude: SHOP.longitude,
      minOrderAmountPaise: 200_000,
      minOrderChargePaise: 10_000,
      freeDeliveryAbovePaise: 1_500_000,
      freeDeliveryRadiusKm: 3,
    },
  });

  await prisma.distanceSlab.createMany({
    data: [
      { fromKm: 0, toKm: 5, chargePaise: 10_000 },
      { fromKm: 5, toKm: 15, chargePaise: 25_000 },
      { fromKm: 15, toKm: 30, chargePaise: 50_000 },
    ],
  });

  await prisma.serviceablePincode.createMany({
    data: [
      { pincode: '411005', areaName: 'Shivaji Nagar', city: 'Pune', latitude: 18.5308, longitude: 73.8478 },
      { pincode: '411045', areaName: 'Baner', city: 'Pune', latitude: 18.559, longitude: 73.7868 },
      { pincode: '411057', areaName: 'Hinjewadi', city: 'Pune', latitude: 18.5913, longitude: 73.7389 },
      { pincode: '413001', areaName: 'Solapur Road', city: 'Solapur', latitude: 18.9, longitude: 74.2 },
    ],
  });

  const tmtProduct = await prisma.product.create({
    data: {
      sku: 'STL-TMT-008',
      name: 'TATA Tiscon 8 mm TMT Bar',
      brand: 'TATA Tiscon',
      sizeVariant: '8 mm',
      unit: 'KG',
      pricePaise: 6850,
      stockQuantity: 1000,
      categoryId: tmt.id,
    },
  });

  const cementBag = await prisma.product.create({
    data: {
      sku: 'CEM-ULT-OPC53',
      name: 'UltraTech OPC 53 Grade Cement',
      brand: 'UltraTech',
      sizeVariant: '50 kg bag',
      unit: 'BAG',
      pricePaise: 41_000,
      stockQuantity: 500,
      categoryId: opc.id,
    },
  });

  return { steel, tmt, cement, opc, tmtProduct, cementBag };
}

export async function loginAs(phone: string, accountType: AccountType, name = 'Test User') {
  return signUpOrLogin(phone, { accountType, name });
}

export async function createAddress(
  userId: string,
  pincode: string,
  latitude: number,
  longitude: number,
) {
  return prisma.address.create({
    data: {
      userId,
      label: 'Site',
      contactName: 'Test User',
      contactPhone: '9876543210',
      line1: 'Plot 1',
      city: 'Pune',
      state: 'Maharashtra',
      pincode,
      latitude,
      longitude,
      isDefault: true,
    },
  });
}

export async function createBulkDiscount(overrides: Record<string, unknown> = {}) {
  return prisma.bulkDiscount.create({
    data: {
      name: 'Buy 10 or more - 3% off',
      minQuantity: 10,
      discountBps: 300,
      ...overrides,
    },
  });
}

export async function createContractorRule(overrides: Record<string, unknown> = {}) {
  return prisma.contractorRule.create({
    data: { name: 'Cement contractor discount', discountBps: 500, ...overrides },
  });
}
