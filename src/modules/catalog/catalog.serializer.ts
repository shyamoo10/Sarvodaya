import type { Category, Product } from '@prisma/client';

export type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  children: CategoryNode[];
};

export function serializeCategory(
  category: Category,
  productCount: number,
): Omit<CategoryNode, 'children'> {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    parentId: category.parentId,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    productCount,
  };
}

type ProductWithCategory = Product & { category: Category };

/**
 * Public product shape. Stock is exposed only as an in-stock flag so the exact
 * inventory count stays internal; admins get stockQuantity from the admin shape.
 */
export function serializePublicProduct(product: ProductWithCategory) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    brand: product.brand,
    sizeVariant: product.sizeVariant,
    unit: product.unit.toLowerCase(),
    pricePaise: product.pricePaise,
    inStock: product.stockQuantity > 0,
    photos: product.photos,
    category: {
      id: product.category.id,
      name: product.category.name,
      slug: product.category.slug,
    },
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function serializeAdminProduct(product: ProductWithCategory) {
  return {
    ...serializePublicProduct(product),
    stockQuantity: product.stockQuantity,
    isActive: product.isActive,
    categoryId: product.categoryId,
  };
}
