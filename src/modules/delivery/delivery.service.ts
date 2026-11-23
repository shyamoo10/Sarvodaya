import type { DistanceSlab, ServiceablePincode, ShopSettings } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError, parsePagination } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { distanceInKm } from '../../lib/geo';
import { getShopSettings } from '../pricing/pricing.service';
import type {
  CreatePincodeInput,
  CreateSlabInput,
  PincodeQuery,
  UpdatePincodeInput,
  UpdateSlabInput,
} from './delivery.schemas';

// --- Distance slabs -------------------------------------------------------

export function listSlabs(): Promise<DistanceSlab[]> {
  return prisma.distanceSlab.findMany({ orderBy: [{ fromKm: 'asc' }, { createdAt: 'asc' }] });
}

function overlaps(
  a: { fromKm: number; toKm: number | null },
  b: { fromKm: number; toKm: number | null },
): boolean {
  const aTo = a.toKm ?? Number.POSITIVE_INFINITY;
  const bTo = b.toKm ?? Number.POSITIVE_INFINITY;
  return a.fromKm < bTo && b.fromKm < aTo;
}

async function assertNoOverlap(
  candidate: { fromKm: number; toKm: number | null; isActive: boolean },
  ignoreId?: string,
): Promise<void> {
  if (!candidate.isActive) return;

  const active = await prisma.distanceSlab.findMany({ where: { isActive: true } });
  const clash = active.find((slab) => slab.id !== ignoreId && overlaps(candidate, slab));
  if (clash) {
    const end = clash.toKm === null ? 'and beyond' : `to ${clash.toKm} km`;
    throw new ApiError(
      409,
      ErrorCode.DELIVERY_SLAB_OVERLAP,
      `This slab overlaps the existing ${clash.fromKm} km ${end} slab`,
    );
  }
}

export async function createSlab(input: CreateSlabInput): Promise<DistanceSlab> {
  await assertNoOverlap(input);
  return prisma.distanceSlab.create({ data: input });
}

export async function updateSlab(id: string, input: UpdateSlabInput): Promise<DistanceSlab> {
  const existing = await prisma.distanceSlab.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Delivery slab not found');
  }

  const next = {
    fromKm: input.fromKm ?? existing.fromKm,
    toKm: input.toKm === undefined ? existing.toKm : input.toKm,
    isActive: input.isActive ?? existing.isActive,
  };
  if (next.toKm !== null && next.toKm <= next.fromKm) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      { field: 'toKm', message: 'The end of the slab must be greater than its start' },
    ]);
  }

  await assertNoOverlap(next, id);

  return prisma.distanceSlab.update({
    where: { id },
    data: {
      ...(input.fromKm === undefined ? {} : { fromKm: input.fromKm }),
      ...(input.toKm === undefined ? {} : { toKm: input.toKm }),
      ...(input.chargePaise === undefined ? {} : { chargePaise: input.chargePaise }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });
}

export async function deleteSlab(id: string): Promise<void> {
  const existing = await prisma.distanceSlab.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Delivery slab not found');
  }
  await prisma.distanceSlab.delete({ where: { id } });
}

// --- Serviceable pincodes -------------------------------------------------

export async function listPincodes(query: PincodeQuery) {
  const { page, limit, skip } = parsePagination(query);
  const search = query.search;

  const where = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive === 'true' }),
    ...(search
      ? {
          OR: [
            { pincode: { contains: search } },
            { areaName: { contains: search, mode: 'insensitive' as const } },
            { city: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.serviceablePincode.count({ where }),
    prisma.serviceablePincode.findMany({
      where,
      orderBy: [{ pincode: 'asc' }],
      skip,
      take: limit,
    }),
  ]);

  return { items, total, page, limit };
}

export function serializePincode(pincode: ServiceablePincode) {
  return {
    pincode: pincode.pincode,
    areaName: pincode.areaName,
    city: pincode.city,
    latitude: pincode.latitude,
    longitude: pincode.longitude,
    isActive: pincode.isActive,
    createdAt: pincode.createdAt.toISOString(),
    updatedAt: pincode.updatedAt.toISOString(),
  };
}

export function serializeSlab(slab: DistanceSlab) {
  return {
    id: slab.id,
    fromKm: slab.fromKm,
    toKm: slab.toKm,
    chargePaise: slab.chargePaise,
    isActive: slab.isActive,
    createdAt: slab.createdAt.toISOString(),
    updatedAt: slab.updatedAt.toISOString(),
  };
}

export async function createPincode(input: CreatePincodeInput): Promise<ServiceablePincode> {
  try {
    return await prisma.serviceablePincode.create({
      data: {
        pincode: input.pincode,
        areaName: input.areaName ?? null,
        city: input.city ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        isActive: input.isActive,
      },
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new ApiError(
        409,
        ErrorCode.DUPLICATE_PINCODE,
        `Pincode ${input.pincode} is already in the delivery list`,
      );
    }
    throw error;
  }
}

export async function updatePincode(
  pincode: string,
  input: UpdatePincodeInput,
): Promise<ServiceablePincode> {
  const existing = await prisma.serviceablePincode.findUnique({ where: { pincode } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Pincode not found');
  }

  return prisma.serviceablePincode.update({
    where: { pincode },
    data: {
      ...(input.areaName === undefined ? {} : { areaName: input.areaName }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
      ...(input.longitude === undefined ? {} : { longitude: input.longitude }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });
}

export async function deletePincode(pincode: string): Promise<void> {
  const existing = await prisma.serviceablePincode.findUnique({ where: { pincode } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Pincode not found');
  }
  await prisma.serviceablePincode.delete({ where: { pincode } });
}

// --- Delivery quote -------------------------------------------------------

export type DeliveryLocation = {
  addressId: string | null;
  pincode: string;
  latitude: number;
  longitude: number;
};

/**
 * Resolves where the cart is delivered: the address asked for, then the address
 * saved on the cart, then the customer's default (else newest) address.
 * Only approved pincodes are accepted.
 */
export async function resolveDeliveryLocation(
  userId: string,
  cartAddressId: string | null,
  requestedAddressId?: string,
): Promise<DeliveryLocation | null> {
  const addressId = requestedAddressId ?? cartAddressId ?? undefined;

  const address = addressId
    ? await prisma.address.findFirst({ where: { id: addressId, userId } })
    : await prisma.address.findFirst({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });

  if (!address) {
    if (addressId) {
      throw new ApiError(404, ErrorCode.NOT_FOUND, 'Address not found');
    }
    // The account has no address yet: the cart is still readable, it just has no
    // delivery charge until an address is added.
    return null;
  }

  const approved = await prisma.serviceablePincode.findUnique({
    where: { pincode: address.pincode },
  });

  if (!approved || !approved.isActive) {
    throw new ApiError(
      400,
      ErrorCode.PINCODE_NOT_SERVICEABLE,
      `Sorry, we do not deliver to pincode ${address.pincode} yet. Please choose another delivery address or contact the shop.`,
      { pincode: address.pincode },
    );
  }

  return {
    addressId: address.id,
    pincode: address.pincode,
    latitude: address.latitude ?? approved.latitude,
    longitude: address.longitude ?? approved.longitude,
  };
}

export type DistanceCharge = {
  distanceKm: number;
  chargePaise: number;
  slabId: string | null;
  isFreeDelivery: boolean;
  freeDeliveryReason: 'ORDER_ABOVE_AMOUNT' | 'WITHIN_RADIUS' | null;
};

/**
 * Charge for delivering to a location, using the admin's slabs and free-delivery
 * rules. A distance no slab covers is out of the delivery area.
 */
export async function quoteDistanceCharge(
  itemTotalPaise: number,
  location: { latitude: number; longitude: number },
  settings?: ShopSettings,
): Promise<DistanceCharge> {
  const shop = settings ?? (await getShopSettings());
  const distanceKm = distanceInKm(
    { latitude: shop.shopLatitude, longitude: shop.shopLongitude },
    location,
  );

  const freeByAmount =
    shop.freeDeliveryAbovePaise !== null &&
    shop.freeDeliveryAbovePaise > 0 &&
    itemTotalPaise >= shop.freeDeliveryAbovePaise;
  const freeByRadius =
    shop.freeDeliveryRadiusKm !== null && distanceKm <= shop.freeDeliveryRadiusKm;

  if (freeByAmount || freeByRadius) {
    return {
      distanceKm,
      chargePaise: 0,
      slabId: null,
      isFreeDelivery: true,
      freeDeliveryReason: freeByRadius ? 'WITHIN_RADIUS' : 'ORDER_ABOVE_AMOUNT',
    };
  }

  const slabs = await prisma.distanceSlab.findMany({
    where: { isActive: true },
    orderBy: [{ fromKm: 'asc' }],
  });
  const slab = slabs.find(
    (row) => distanceKm >= row.fromKm && (row.toKm === null || distanceKm < row.toKm),
  );

  if (!slab) {
    throw new ApiError(
      400,
      ErrorCode.OUT_OF_DELIVERY_RANGE,
      `Sorry, this address is ${distanceKm} km from the shop, outside our delivery area. Please contact the shop to arrange delivery.`,
      { distanceKm },
    );
  }

  return {
    distanceKm,
    chargePaise: slab.chargePaise,
    slabId: slab.id,
    isFreeDelivery: slab.chargePaise === 0,
    freeDeliveryReason: null,
  };
}
