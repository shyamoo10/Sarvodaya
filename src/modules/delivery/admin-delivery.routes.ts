import { Router } from 'express';
import { asyncHandler, sendNoContent, sendSuccess } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createPincodeSchema,
  createSlabSchema,
  pincodeQuerySchema,
  updatePincodeSchema,
  updateSlabSchema,
  type CreatePincodeInput,
  type CreateSlabInput,
  type PincodeQuery,
  type UpdatePincodeInput,
  type UpdateSlabInput,
} from './delivery.schemas';
import {
  createPincode,
  createSlab,
  deletePincode,
  deleteSlab,
  listPincodes,
  listSlabs,
  serializePincode,
  serializeSlab,
  updatePincode,
  updateSlab,
} from './delivery.service';

export const adminDeliveryRouter = Router();

adminDeliveryRouter.use(requireAuth, requireAdmin);

// --- Distance slabs -------------------------------------------------------

adminDeliveryRouter.get(
  '/slabs',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, (await listSlabs()).map(serializeSlab), 200);
  }),
);

adminDeliveryRouter.post(
  '/slabs',
  validate(createSlabSchema),
  asyncHandler(async (req, res) => {
    const slab = await createSlab(req.body as CreateSlabInput);
    sendSuccess(res, serializeSlab(slab), 201);
  }),
);

adminDeliveryRouter.patch(
  '/slabs/:id',
  validate(updateSlabSchema),
  asyncHandler(async (req, res) => {
    const slab = await updateSlab(req.params.id as string, req.body as UpdateSlabInput);
    sendSuccess(res, serializeSlab(slab), 200);
  }),
);

adminDeliveryRouter.delete(
  '/slabs/:id',
  asyncHandler(async (req, res) => {
    await deleteSlab(req.params.id as string);
    sendNoContent(res);
  }),
);

// --- Serviceable pincodes -------------------------------------------------

adminDeliveryRouter.get(
  '/pincodes',
  validate(pincodeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as PincodeQuery;
    const result = await listPincodes(query);
    sendSuccess(res, result.items.map(serializePincode), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

adminDeliveryRouter.post(
  '/pincodes',
  validate(createPincodeSchema),
  asyncHandler(async (req, res) => {
    const pincode = await createPincode(req.body as CreatePincodeInput);
    sendSuccess(res, serializePincode(pincode), 201);
  }),
);

adminDeliveryRouter.patch(
  '/pincodes/:pincode',
  validate(updatePincodeSchema),
  asyncHandler(async (req, res) => {
    const pincode = await updatePincode(req.params.pincode as string, req.body as UpdatePincodeInput);
    sendSuccess(res, serializePincode(pincode), 200);
  }),
);

adminDeliveryRouter.delete(
  '/pincodes/:pincode',
  asyncHandler(async (req, res) => {
    await deletePincode(req.params.pincode as string);
    sendNoContent(res);
  }),
);
