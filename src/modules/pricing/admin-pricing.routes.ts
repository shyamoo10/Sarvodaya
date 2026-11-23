import { Router } from 'express';
import { asyncHandler, sendNoContent, sendSuccess } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../users/user.schemas';
import {
  bulkDiscountCreateSchema,
  bulkDiscountUpdateSchema,
  contractorPriceCreateSchema,
  contractorPriceQuerySchema,
  contractorPriceUpdateSchema,
  contractorRuleCreateSchema,
  contractorRuleUpdateSchema,
  pricingRuleQuerySchema,
  updateShopSettingsSchema,
  type BulkDiscountCreateInput,
  type BulkDiscountUpdateInput,
  type ContractorPriceCreateInput,
  type ContractorPriceQuery,
  type ContractorPriceUpdateInput,
  type ContractorRuleCreateInput,
  type ContractorRuleUpdateInput,
  type PricingRuleQuery,
  type UpdateShopSettingsInput,
} from './pricing.schemas';
import {
  createBulkDiscount,
  createContractorPrice,
  createContractorRule,
  deleteBulkDiscount,
  deleteContractorPrice,
  deleteContractorRule,
  getShopSettings,
  listBulkDiscounts,
  listContractorPrices,
  listContractorRules,
  updateBulkDiscount,
  updateContractorPrice,
  updateContractorRule,
  updateShopSettings,
} from './pricing.service';
import {
  serializeBulkDiscount,
  serializeContractorPrice,
  serializeContractorRule,
  serializeShopSettings,
} from './pricing.serializer';

export const adminPricingRouter = Router();

adminPricingRouter.use(requireAuth, requireAdmin);

// --- Shop pricing and delivery settings ----------------------------------

adminPricingRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, serializeShopSettings(await getShopSettings()), 200);
  }),
);

adminPricingRouter.patch(
  '/settings',
  validate(updateShopSettingsSchema),
  asyncHandler(async (req, res) => {
    const settings = await updateShopSettings(req.body as UpdateShopSettingsInput);
    sendSuccess(res, serializeShopSettings(settings), 200);
  }),
);

// --- Contractor special prices -------------------------------------------

adminPricingRouter.get(
  '/contractor-prices',
  validate(contractorPriceQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as ContractorPriceQuery;
    const result = await listContractorPrices(query);
    sendSuccess(res, result.items.map(serializeContractorPrice), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

adminPricingRouter.post(
  '/contractor-prices',
  validate(contractorPriceCreateSchema),
  asyncHandler(async (req, res) => {
    const price = await createContractorPrice(req.body as ContractorPriceCreateInput);
    sendSuccess(res, serializeContractorPrice(price), 201);
  }),
);

adminPricingRouter.patch(
  '/contractor-prices/:id',
  validate(idParamSchema, 'params'),
  validate(contractorPriceUpdateSchema),
  asyncHandler(async (req, res) => {
    const price = await updateContractorPrice(
      req.params.id as string,
      req.body as ContractorPriceUpdateInput,
    );
    sendSuccess(res, serializeContractorPrice(price), 200);
  }),
);

adminPricingRouter.delete(
  '/contractor-prices/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    await deleteContractorPrice(req.params.id as string);
    sendNoContent(res);
  }),
);

// --- Bulk quantity discounts ---------------------------------------------

adminPricingRouter.get(
  '/bulk-discounts',
  validate(pricingRuleQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as PricingRuleQuery;
    const result = await listBulkDiscounts(query);
    sendSuccess(res, result.items.map(serializeBulkDiscount), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

adminPricingRouter.post(
  '/bulk-discounts',
  validate(bulkDiscountCreateSchema),
  asyncHandler(async (req, res) => {
    const discount = await createBulkDiscount(req.body as BulkDiscountCreateInput);
    sendSuccess(res, serializeBulkDiscount(discount), 201);
  }),
);

adminPricingRouter.patch(
  '/bulk-discounts/:id',
  validate(idParamSchema, 'params'),
  validate(bulkDiscountUpdateSchema),
  asyncHandler(async (req, res) => {
    const discount = await updateBulkDiscount(
      req.params.id as string,
      req.body as BulkDiscountUpdateInput,
    );
    sendSuccess(res, serializeBulkDiscount(discount), 200);
  }),
);

adminPricingRouter.delete(
  '/bulk-discounts/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    await deleteBulkDiscount(req.params.id as string);
    sendNoContent(res);
  }),
);

// --- Contractor percentage rules -----------------------------------------

adminPricingRouter.get(
  '/contractor-rules',
  validate(pricingRuleQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as PricingRuleQuery;
    const result = await listContractorRules(query);
    sendSuccess(res, result.items.map(serializeContractorRule), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

adminPricingRouter.post(
  '/contractor-rules',
  validate(contractorRuleCreateSchema),
  asyncHandler(async (req, res) => {
    const rule = await createContractorRule(req.body as ContractorRuleCreateInput);
    sendSuccess(res, serializeContractorRule(rule), 201);
  }),
);

adminPricingRouter.patch(
  '/contractor-rules/:id',
  validate(idParamSchema, 'params'),
  validate(contractorRuleUpdateSchema),
  asyncHandler(async (req, res) => {
    const rule = await updateContractorRule(
      req.params.id as string,
      req.body as ContractorRuleUpdateInput,
    );
    sendSuccess(res, serializeContractorRule(rule), 200);
  }),
);

adminPricingRouter.delete(
  '/contractor-rules/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    await deleteContractorRule(req.params.id as string);
    sendNoContent(res);
  }),
);
