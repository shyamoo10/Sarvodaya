import { Router } from 'express';
import { asyncHandler, sendSuccess, sendNoContent, ApiError } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { importFileUpload } from '../../middleware/upload';
import { idParamSchema } from '../users/user.schemas';
import {
  adminProductQuerySchema,
  createCategorySchema,
  createProductSchema,
  stockUpdateSchema,
  updateCategorySchema,
  updateProductSchema,
  type AdminProductQuery,
  type CreateCategoryInput,
  type CreateProductInput,
  type StockUpdateInput,
  type UpdateCategoryInput,
  type UpdateProductInput,
} from './catalog.schemas';
import {
  createCategory,
  deleteCategory,
  listCategoryTree,
  updateCategory,
} from './categories.service';
import {
  createProduct,
  getProduct,
  listAdminProducts,
  updateProduct,
  updateStock,
} from './products.service';
import {
  serializeAdminProduct,
  serializeCategory,
} from './catalog.serializer';
import { importProductsFromWorkbook } from './products-import.service';

export const adminCatalogRouter = Router();

adminCatalogRouter.use(requireAuth, requireAdmin);

// --- Categories -----------------------------------------------------------

adminCatalogRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await listCategoryTree(true), 200);
  }),
);

adminCatalogRouter.post(
  '/categories',
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await createCategory(req.body as CreateCategoryInput);
    sendSuccess(res, serializeCategory(category, 0), 201);
  }),
);

adminCatalogRouter.patch(
  '/categories/:id',
  validate(idParamSchema, 'params'),
  validate(updateCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await updateCategory(req.params.id as string, req.body as UpdateCategoryInput);
    sendSuccess(res, serializeCategory(category, 0), 200);
  }),
);

adminCatalogRouter.delete(
  '/categories/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    await deleteCategory(req.params.id as string);
    sendNoContent(res);
  }),
);

// --- Products -------------------------------------------------------------

adminCatalogRouter.get(
  '/products',
  validate(adminProductQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as AdminProductQuery;
    const result = await listAdminProducts(query);

    sendSuccess(res, result.items.map(serializeAdminProduct), 200, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit),
    });
  }),
);

adminCatalogRouter.post(
  '/products',
  validate(createProductSchema),
  asyncHandler(async (req, res) => {
    const product = await createProduct(req.body as CreateProductInput);
    sendSuccess(res, serializeAdminProduct(product), 201);
  }),
);

adminCatalogRouter.post(
  '/products/import',
  importFileUpload,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new ApiError(
        400,
        ErrorCode.INVALID_IMPORT_FILE,
        'Attach the Excel file in the "file" field',
      );
    }
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new ApiError(400, ErrorCode.INVALID_IMPORT_FILE, 'Only .xlsx files are supported');
    }

    const report = await importProductsFromWorkbook(file.buffer);
    sendSuccess(res, report, 200);
  }),
);

adminCatalogRouter.get(
  '/products/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const product = await getProduct(req.params.id as string, { admin: true });
    sendSuccess(res, serializeAdminProduct(product), 200);
  }),
);

adminCatalogRouter.patch(
  '/products/:id',
  validate(idParamSchema, 'params'),
  validate(updateProductSchema),
  asyncHandler(async (req, res) => {
    const product = await updateProduct(req.params.id as string, req.body as UpdateProductInput);
    sendSuccess(res, serializeAdminProduct(product), 200);
  }),
);

adminCatalogRouter.patch(
  '/products/:id/stock',
  validate(idParamSchema, 'params'),
  validate(stockUpdateSchema),
  asyncHandler(async (req, res) => {
    const product = await updateStock(req.params.id as string, req.body as StockUpdateInput);
    sendSuccess(res, serializeAdminProduct(product), 200);
  }),
);
