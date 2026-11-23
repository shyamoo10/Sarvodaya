import type { BulkDiscount, Category, ContractorRule, Product, ShopSettings } from '@prisma/client';

export function serializeShopSettings(settings: ShopSettings) {
  return {
    shopLatitude: settings.shopLatitude,
    shopLongitude: settings.shopLongitude,
    minOrderAmountPaise: settings.minOrderAmountPaise,
    minOrderChargePaise: settings.minOrderChargePaise,
    freeDeliveryAbovePaise: settings.freeDeliveryAbovePaise,
    freeDeliveryRadiusKm: settings.freeDeliveryRadiusKm,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

type ContractorPriceWithRelations = {
  id: string;
  contractorId: string;
  productId: string;
  pricePaise: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  product: Pick<Product, 'id' | 'sku' | 'name' | 'brand' | 'sizeVariant' | 'unit' | 'pricePaise'>;
};

export function serializeContractorPrice(price: ContractorPriceWithRelations) {
  return {
    id: price.id,
    contractorId: price.contractorId,
    productId: price.productId,
    pricePaise: price.pricePaise,
    isActive: price.isActive,
    product: {
      id: price.product.id,
      sku: price.product.sku,
      name: price.product.name,
      brand: price.product.brand,
      sizeVariant: price.product.sizeVariant,
      unit: price.product.unit.toLowerCase(),
      pricePaise: price.product.pricePaise,
    },
    createdAt: price.createdAt.toISOString(),
    updatedAt: price.updatedAt.toISOString(),
  };
}

type BulkDiscountWithCategory = BulkDiscount & { category: Category | null };

export function serializeBulkDiscount(discount: BulkDiscountWithCategory) {
  return {
    id: discount.id,
    name: discount.name,
    productId: discount.productId,
    categoryId: discount.categoryId,
    category: discount.category
      ? { id: discount.category.id, name: discount.category.name, slug: discount.category.slug }
      : null,
    minQuantity: discount.minQuantity,
    discountBps: discount.discountBps,
    discountPercent: discount.discountBps / 100,
    isActive: discount.isActive,
    createdAt: discount.createdAt.toISOString(),
    updatedAt: discount.updatedAt.toISOString(),
  };
}

type ContractorRuleWithCategory = ContractorRule & { category: Category | null };

export function serializeContractorRule(rule: ContractorRuleWithCategory) {
  return {
    id: rule.id,
    name: rule.name,
    categoryId: rule.categoryId,
    category: rule.category
      ? { id: rule.category.id, name: rule.category.name, slug: rule.category.slug }
      : null,
    discountBps: rule.discountBps,
    discountPercent: rule.discountBps / 100,
    isActive: rule.isActive,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}
