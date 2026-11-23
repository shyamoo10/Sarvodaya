import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { asyncHandler, sendSuccess, sendNoContent, ApiError } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { ErrorCode } from '../../config/error-codes';
import {
  createAddressSchema,
  updateAddressSchema,
  idParamSchema,
} from './user.schemas';
import { serializeAddress } from './user.serializer';

export const addressesRouter = Router();

addressesRouter.use(requireAuth);

type AddressBody = {
  label?: string | null;
  contactName: string;
  contactPhone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
};

async function findOwnedAddress(userId: string, id: string) {
  const address = await prisma.address.findFirst({ where: { id, userId } });
  if (!address) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Address not found');
  }
  return address;
}

addressesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const addresses = await prisma.address.findMany({
      where: { userId: req.authUser!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    sendSuccess(res, addresses.map(serializeAddress), 200);
  }),
);

addressesRouter.post(
  '/',
  validate(createAddressSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as AddressBody;
    const userId = req.authUser!.id;

    const address = await prisma.$transaction(async (tx) => {
      const existingCount = await tx.address.count({ where: { userId } });
      const shouldBeDefault = body.isDefault === true || existingCount === 0;

      if (shouldBeDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }

      return tx.address.create({
        data: {
          userId,
          label: body.label ?? null,
          contactName: body.contactName,
          contactPhone: body.contactPhone,
          line1: body.line1,
          line2: body.line2 ?? null,
          landmark: body.landmark ?? null,
          city: body.city,
          state: body.state,
          pincode: body.pincode,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          isDefault: shouldBeDefault,
        },
      });
    });

    sendSuccess(res, serializeAddress(address), 201);
  }),
);

addressesRouter.get(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const address = await findOwnedAddress(req.authUser!.id, req.params.id as string);
    sendSuccess(res, serializeAddress(address), 200);
  }),
);

addressesRouter.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateAddressSchema),
  asyncHandler(async (req, res) => {
    const userId = req.authUser!.id;
    const existing = await findOwnedAddress(userId, req.params.id as string);
    const body = req.body as Partial<AddressBody>;

    const data: Prisma.AddressUpdateInput = {};
    if (body.label !== undefined) data.label = body.label;
    if (body.contactName !== undefined) data.contactName = body.contactName;
    if (body.contactPhone !== undefined) data.contactPhone = body.contactPhone;
    if (body.line1 !== undefined) data.line1 = body.line1;
    if (body.line2 !== undefined) data.line2 = body.line2;
    if (body.landmark !== undefined) data.landmark = body.landmark;
    if (body.city !== undefined) data.city = body.city;
    if (body.state !== undefined) data.state = body.state;
    if (body.pincode !== undefined) data.pincode = body.pincode;
    if (body.latitude !== undefined) data.latitude = body.latitude;
    if (body.longitude !== undefined) data.longitude = body.longitude;
    if (body.isDefault !== undefined) data.isDefault = body.isDefault;

    const address = await prisma.$transaction(async (tx) => {
      if (body.isDefault === true && !existing.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.update({ where: { id: existing.id }, data });
    });

    sendSuccess(res, serializeAddress(address), 200);
  }),
);

addressesRouter.delete(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const userId = req.authUser!.id;
    const existing = await findOwnedAddress(userId, req.params.id as string);

    await prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id: existing.id } });
      if (existing.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        if (next) {
          await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });

    sendNoContent(res);
  }),
);
