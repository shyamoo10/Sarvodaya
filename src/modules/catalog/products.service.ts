import { Prisma, type Category, type Product, type ProductUnit } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError, parsePagination } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { resolveCategoryIds } from './categories.service';
import type {
  AdminProductQuery,
  CreateProductInput,
  ProductQuery,
  StockUpdateInput,
  UpdateProductInput,
} from './catalog.schemas';

type ProductWithCategory = Product & { category: Category };

export type ProductListResult = {
  items: ProductWithCategory[];
  total: number;
  page: number;
  limit: number;
};

function buildOrderBy(sort: ProductQuery['sort']): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ pricePaise: 'asc' }, { name: 'asc' }];
    case 'price_desc':
      return [{ pricePaise: 'desc' }, { name: 'asc' }];
    case 'name_asc':
      return [{ name: 'asc' }];
    case 'newest':
    default:
      return [{ createdAt: 'desc' }, { name: 'asc' }];
  }
}

/**
 * Builds the shared filter. Returns null when the category slug is unknown so the
 * caller can answer with an empty page instead of an error.
 */
async function buildWhere(
  query: ProductQuery & { isActive?: boolean },
  options: { onlyActive: boolean },
): Promise<Prisma.ProductWhereInput | null> {
  const where: Prisma.ProductWhereInput = {};

  if (options.onlyActive) {
    where.isActive = true;
  } else if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  if (query.category) {
    const categoryIds = await resolveCategoryIds(query.category);
    if (!categoryIds) return null;
    where.categoryId = { in: categoryIds };
  }

  if (query.brand) {
    where.brand = { equals: query.brand, mode: 'insensitive' };
  }

  if (query.minPricePaise !== undefined || query.maxPricePaise !== undefined) {
    where.pricePaise = {
      ...(query.minPricePaise === undefined ? {} : { gte: query.minPricePaise }),
      ...(query.maxPricePaise === undefined ? {} : { lte: query.maxPricePaise }),
    };
  }

  if (query.inStock !== undefined) {
    where.stockQuantity = query.inStock ? { gt: 0 } : { lte: 0 };
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { brand: { contains: query.search, mode: 'insensitive' } },
      { sku: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

async function listProducts(
  query: ProductQuery & { isActive?: boolean },
  options: { onlyActive: boolean },
): Promise<ProductListResult> {
  const { page, limit, skip } = parsePagination(query);
  const where = await buildWhere(query, options);

  if (!where) {
    return { items: [], total: 0, page, limit };
  }

  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: buildOrderBy(query.sort),
      skip,
      take: limit,
    }),
  ]);

  return { items, total, page, limit };
}

/** Public catalogue: hidden products never appear, stock is not disclosed. */
export function listPublicProducts(query: ProductQuery): Promise<ProductListResult> {
  return listProducts(query, { onlyActive: true });
}

export function listAdminProducts(query: AdminProductQuery): Promise<ProductListResult> {
  return listProducts(query, { onlyActive: false });
}

export async function getProduct(id: string, options: { admin: boolean }): Promise<ProductWithCategory> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { category: true },
  });
  if (!product || (!options.admin && !product.isActive)) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Product not found');
  }
  return product;
}

function toUnitEnum(unit: string): ProductUnit {
  return unit.toUpperCase() as ProductUnit;
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!category) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Category not found');
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function createProduct(input: CreateProductInput): Promise<ProductWithCategory> {
  await assertCategoryExists(input.categoryId);

  try {
    return await prisma.product.create({
      data: {
        sku: input.sku,
        name: input.name,
        description: input.description ?? null,
        brand: input.brand,
        sizeVariant: input.sizeVariant ?? null,
        unit: toUnitEnum(input.unit),
        pricePaise: input.pricePaise,
        stockQuantity: input.stockQuantity,
        photos: input.photos,
        categoryId: input.categoryId,
        isActive: input.isActive,
      },
      include: { category: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, ErrorCode.SKU_ALREADY_EXISTS, `A product with SKU ${input.sku} already exists`);
    }
    throw error;
  }
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<ProductWithCategory> {
  const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Product not found');
  }
  if (input.categoryId !== undefined) {
    await assertCategoryExists(input.categoryId);
  }

  return prisma.product.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.brand === undefined ? {} : { brand: input.brand }),
      ...(input.sizeVariant === undefined ? {} : { sizeVariant: input.sizeVariant }),
      ...(input.unit === undefined ? {} : { unit: toUnitEnum(input.unit) }),
      ...(input.pricePaise === undefined ? {} : { pricePaise: input.pricePaise }),
      ...(input.stockQuantity === undefined ? {} : { stockQuantity: input.stockQuantity }),
      ...(input.photos === undefined ? {} : { photos: input.photos }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
    include: { category: true },
  });
}

export async function updateStock(
  id: string,
  input: StockUpdateInput,
): Promise<ProductWithCategory> {
  const existing = await prisma.product.findUnique({ where: { id }, select: { stockQuantity: true } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Product not found');
  }

  const nextStock =
    input.stockQuantity !== undefined
      ? input.stockQuantity
      : existing.stockQuantity + (input.adjustment ?? 0);

  if (nextStock < 0) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      {
        field: 'adjustment',
        message: `Stock cannot go below zero (current stock is ${existing.stockQuantity})`,
      },
    ]);
  }

  return prisma.product.update({
    where: { id },
    data: { stockQuantity: nextStock },
    include: { category: true },
  });
}
