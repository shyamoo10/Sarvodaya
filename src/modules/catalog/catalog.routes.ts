import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { listCategoryTree } from './categories.service';
import { getProduct, listPublicProducts } from './products.service';
import { serializePublicProduct } from './catalog.serializer';
import { productQuerySchema, type ProductQuery } from './catalog.schemas';
import { idParamSchema } from '../users/user.schemas';

export const categoriesRouter = Router();

categoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tree = await listCategoryTree(false);
    sendSuccess(res, tree, 200);
  }),
);

export const productsRouter = Router();

productsRouter.get(
  '/',
  validate(productQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as ProductQuery;
    const result = await listPublicProducts(query);

    sendSuccess(res, result.items.map(serializePublicProduct), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

productsRouter.get(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const product = await getProduct(req.params.id as string, { admin: false });
    sendSuccess(res, serializePublicProduct(product), 200);
  }),
);
