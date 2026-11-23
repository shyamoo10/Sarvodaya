import { Prisma, type Category } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { serializeCategory, type CategoryNode } from './catalog.serializer';
import { slugify, type CreateCategoryInput, type UpdateCategoryInput } from './catalog.schemas';

/** Returns the category tree (top-level categories with their sub-categories). */
export async function listCategoryTree(includeInactive = false): Promise<CategoryNode[]> {
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.product.groupBy({
      by: ['categoryId'],
      where: { isActive: true },
      _count: { _all: true },
    }),
  ]);

  const countByCategory = new Map(counts.map((row) => [row.categoryId, row._count._all]));
  const nodes = new Map<string, CategoryNode>();
  for (const category of categories) {
    nodes.set(category.id, {
      ...serializeCategory(category, countByCategory.get(category.id) ?? 0),
      children: [],
    });
  }

  const roots: CategoryNode[] = [];
  for (const category of categories) {
    const node = nodes.get(category.id);
    if (!node) continue;
    const parent = category.parentId ? nodes.get(category.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** Category ids for a slug, including its sub-categories. Null when unknown. */
export async function resolveCategoryIds(slug: string): Promise<string[] | null> {
  const category = await prisma.category.findUnique({
    where: { slug: slug.toLowerCase() },
    include: { children: { select: { id: true } } },
  });
  if (!category || !category.isActive) return null;
  return [category.id, ...category.children.map((child) => child.id)];
}

async function assertParentIsValid(parentId: string | null | undefined, movingId?: string): Promise<void> {
  if (!parentId) return;
  if (movingId && parentId === movingId) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      { field: 'parentId', message: 'A category cannot be its own parent' },
    ]);
  }
  const parent = await prisma.category.findUnique({ where: { id: parentId } });
  if (!parent) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Parent category not found');
  }
  if (parent.parentId) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      {
        field: 'parentId',
        message: 'Only two levels are supported: a sub-category cannot have children',
      },
    ]);
  }
}

async function assertNameIsFree(
  name: string,
  parentId: string | null,
  excludeId?: string,
): Promise<void> {
  const existing = await prisma.category.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      parentId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(
      409,
      ErrorCode.DUPLICATE_CATEGORY,
      `A category named "${name}" already exists at this level`,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function createCategory(input: CreateCategoryInput): Promise<Category> {
  const slug = input.slug ?? slugify(input.name);
  if (!slug) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      { field: 'name', message: 'Name must contain letters or numbers' },
    ]);
  }

  const parentId = input.parentId ?? null;
  await assertParentIsValid(parentId);
  await assertNameIsFree(input.name, parentId);

  try {
    return await prisma.category.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        parentId,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, ErrorCode.DUPLICATE_CATEGORY, `The slug "${slug}" is already taken`);
    }
    throw error;
  }
}

export async function updateCategory(id: string, input: UpdateCategoryInput): Promise<Category> {
  const existing = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { children: true } } },
  });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Category not found');
  }

  const parentId = input.parentId === undefined ? existing.parentId : input.parentId;
  await assertParentIsValid(parentId, id);

  if (parentId && existing._count.children > 0) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      {
        field: 'parentId',
        message: 'A category with sub-categories cannot itself become a sub-category',
      },
    ]);
  }

  if (input.name !== undefined) {
    await assertNameIsFree(input.name, parentId, id);
  }

  try {
    return await prisma.category.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, ErrorCode.DUPLICATE_CATEGORY, 'That slug is already taken');
    }
    throw error;
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const category = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { children: true, products: true } } },
  });
  if (!category) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Category not found');
  }

  if (category._count.products > 0 || category._count.children > 0) {
    throw new ApiError(
      409,
      ErrorCode.CATEGORY_IN_USE,
      'This category still has products or sub-categories. Move or hide them first, or deactivate the category instead.',
      { products: category._count.products, subCategories: category._count.children },
    );
  }

  await prisma.category.delete({ where: { id } });
}
