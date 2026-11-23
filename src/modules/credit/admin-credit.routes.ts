import { Router } from 'express';
import { asyncHandler, sendNoContent, sendSuccess } from '../../lib/http';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../users/user.schemas';
import {
  creditTermsCreateSchema,
  creditTermsQuerySchema,
  creditTermsUpdateSchema,
  type CreditTermsCreateInput,
  type CreditTermsQuery,
  type CreditTermsUpdateInput,
} from './credit.schemas';
import {
  createCreditTerms,
  deleteCreditTerms,
  getCreditTerms,
  listCreditTerms,
  serializeCreditTerms,
  updateCreditTerms,
} from './credit.service';

export const adminCreditRouter = Router();

adminCreditRouter.use(requireAuth, requireAdmin);

adminCreditRouter.get(
  '/',
  validate(creditTermsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as CreditTermsQuery;
    const result = await listCreditTerms(query);
    const items = await Promise.all(result.items.map(serializeCreditTerms));
    sendSuccess(res, items, 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

adminCreditRouter.get(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const terms = await getCreditTerms(req.params.id as string);
    sendSuccess(res, await serializeCreditTerms(terms), 200);
  }),
);

adminCreditRouter.post(
  '/',
  validate(creditTermsCreateSchema),
  asyncHandler(async (req, res) => {
    const terms = await createCreditTerms(req.body as CreditTermsCreateInput);
    sendSuccess(res, await serializeCreditTerms(terms), 201);
  }),
);

adminCreditRouter.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(creditTermsUpdateSchema),
  asyncHandler(async (req, res) => {
    const terms = await updateCreditTerms(
      req.params.id as string,
      req.body as CreditTermsUpdateInput,
    );
    sendSuccess(res, await serializeCreditTerms(terms), 200);
  }),
);

adminCreditRouter.delete(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    await deleteCreditTerms(req.params.id as string);
    sendNoContent(res);
  }),
);
