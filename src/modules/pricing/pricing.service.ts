import { Prisma, type AccountType, type BulkDiscount, type ContractorRule } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError, parsePagination } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import type {
  BulkDiscountCreateInput,
  BulkDiscountUpdateInput,
  ContractorPriceCreateInput,
  ContractorPriceQuery,
  ContractorPriceUpdateInput,
  ContractorRuleCreateInput,
  ContractorRuleUpdateInput,
  PricingRuleQuery,
  UpdateShopSettingsInput,
} from './pricing.schemas';

/**
 * The four pricing outcomes, in the order they are tried. The first rule that
 * applies wins; discounts are never stacked.
 */
export const AppliedRuleType = {
  CONTRACTOR_SPECIAL_PRICE: 'CONTRACTOR_SPECIAL_PRICE',
  BULK_DISCOUNT: 'BULK_DISCOUNT',
  CONTRACTOR_PERCENTAGE: 'CONTRACTOR_PERCENTAGE',
  NORMAL_PRICE: 'NORMAL_PRICE',
} as const;

export type AppliedRuleName = (typeof AppliedRuleType)[keyof typeof AppliedRuleType];

export type AppliedRule = {
  type: AppliedRuleName;
  id: string | null;
  label: string;
};

export type PriceableProduct = {
  id: string;
  categoryId: string;
  pricePaise: number;
  category: { parentId: string | null };
};

export type PricingContext = {
  isContractor: boolean;
  contractorPrices: Map<string, { id: string; pricePaise: number }>;
  bulkDiscounts: BulkDiscount[];
  contractorRules: ContractorRule[];
};

/** Basis points applied to an integer paise price, never rounding below one paisa. */
export function applyDiscount(pricePaise: number, discountBps: number): number {
  return Math.max(1, Math.round((pricePaise * (10_000 - discountBps)) / 10_000));
}

/**
 * Loads every pricing rule that could apply to this account in one round trip,
 * so a cart with many lines is priced without a query per line.
 */
export async function loadPricingContext(user: {
  id: string;
  accountType: AccountType;
}): Promise<PricingContext> {
  const isContractor = user.accountType === 'CONTRACTOR';

  const [contractorPrices, bulkDiscounts, contractorRules] = await Promise.all([
    isContractor
      ? prisma.contractorPrice.findMany({
          where: { contractorId: user.id, isActive: true },
          select: { id: true, productId: true, pricePaise: true },
        })
      : Promise.resolve([]),
    prisma.bulkDiscount.findMany({ where: { isActive: true } }),
    isContractor
      ? prisma.contractorRule.findMany({ where: { isActive: true } })
      : Promise.resolve([]),
  ]);

  return {
    isContractor,
    contractorPrices: new Map(
      contractorPrices.map((price) => [price.productId, { id: price.id, pricePaise: price.pricePaise }]),
    ),
    bulkDiscounts,
    contractorRules,
  };
}

/** 3 = product, 2 = category (or its parent), 1 = whole shop. */
function bulkSpecificity(rule: BulkDiscount, product: PriceableProduct): number {
  if (rule.productId) return rule.productId === product.id ? 3 : 0;
  if (rule.categoryId) {
    return rule.categoryId === product.categoryId || rule.categoryId === product.category.parentId
      ? 2
      : 0;
  }
  return 1;
}

function bestBulkDiscount(
  product: PriceableProduct,
  quantity: number,
  context: PricingContext,
): { rule: BulkDiscount; specificity: number } | null {
  let best: { rule: BulkDiscount; specificity: number } | null = null;

  for (const rule of context.bulkDiscounts) {
    if (quantity < rule.minQuantity) continue;
    const specificity = bulkSpecificity(rule, product);
    if (specificity === 0) continue;

    if (
      !best ||
      specificity > best.specificity ||
      (specificity === best.specificity && rule.minQuantity > best.rule.minQuantity) ||
      (specificity === best.specificity &&
        rule.minQuantity === best.rule.minQuantity &&
        rule.discountBps > best.rule.discountBps)
    ) {
      best = { rule, specificity };
    }
  }

  return best;
}

function contractorRuleSpecificity(rule: ContractorRule, product: PriceableProduct): number {
  if (!rule.categoryId) return 1;
  return rule.categoryId === product.categoryId || rule.categoryId === product.category.parentId
    ? 2
    : 0;
}

function bestContractorRule(
  product: PriceableProduct,
  context: PricingContext,
): { rule: ContractorRule; specificity: number } | null {
  let best: { rule: ContractorRule; specificity: number } | null = null;

  for (const rule of context.contractorRules) {
    const specificity = contractorRuleSpecificity(rule, product);
    if (specificity === 0) continue;

    if (
      !best ||
      specificity > best.specificity ||
      (specificity === best.specificity && rule.discountBps > best.rule.discountBps)
    ) {
      best = { rule, specificity };
    }
  }

  return best;
}

/**
 * Prices one cart line. Order of precedence, as specified for the shop:
 *
 *  1. the contractor's negotiated price for this product
 *  2. a bulk-quantity discount matching the quantity and scope
 *  3. the contractor percentage rule (for example 5% off cement)
 *  4. the normal catalogue price
 */
export function priceLine(
  product: PriceableProduct,
  quantity: number,
  context: PricingContext,
): { originalPricePaise: number; unitPricePaise: number; appliedRule: AppliedRule } {
  const originalPricePaise = product.pricePaise;

  const specialPrice = context.contractorPrices.get(product.id);
  if (specialPrice) {
    return {
      originalPricePaise,
      unitPricePaise: specialPrice.pricePaise,
      appliedRule: {
        type: AppliedRuleType.CONTRACTOR_SPECIAL_PRICE,
        id: specialPrice.id,
        label: 'Your contractor price',
      },
    };
  }

  const bulk = bestBulkDiscount(product, quantity, context);
  if (bulk) {
    return {
      originalPricePaise,
      unitPricePaise: applyDiscount(originalPricePaise, bulk.rule.discountBps),
      appliedRule: {
        type: AppliedRuleType.BULK_DISCOUNT,
        id: bulk.rule.id,
        label: bulk.rule.name,
      },
    };
  }

  const contractorRule = context.isContractor ? bestContractorRule(product, context) : null;
  if (contractorRule) {
    return {
      originalPricePaise,
      unitPricePaise: applyDiscount(originalPricePaise, contractorRule.rule.discountBps),
      appliedRule: {
        type: AppliedRuleType.CONTRACTOR_PERCENTAGE,
        id: contractorRule.rule.id,
        label: contractorRule.rule.name,
      },
    };
  }

  return {
    originalPricePaise,
    unitPricePaise: originalPricePaise,
    appliedRule: { type: AppliedRuleType.NORMAL_PRICE, id: null, label: 'Standard price' },
  };
}

// --- Shop settings --------------------------------------------------------

/** The single settings row, created with neutral defaults on first read. */
export async function getShopSettings() {
  return prisma.shopSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      shopLatitude: 18.5204,
      shopLongitude: 73.8567,
      minOrderAmountPaise: 0,
      minOrderChargePaise: 0,
      freeDeliveryAbovePaise: null,
      freeDeliveryRadiusKm: null,
    },
  });
}

export async function updateShopSettings(input: UpdateShopSettingsInput) {
  const settings = await getShopSettings();
  return prisma.shopSettings.update({
    where: { id: settings.id },
    data: {
      ...(input.shopLatitude === undefined ? {} : { shopLatitude: input.shopLatitude }),
      ...(input.shopLongitude === undefined ? {} : { shopLongitude: input.shopLongitude }),
      ...(input.minOrderAmountPaise === undefined
        ? {}
        : { minOrderAmountPaise: input.minOrderAmountPaise }),
      ...(input.minOrderChargePaise === undefined
        ? {}
        : { minOrderChargePaise: input.minOrderChargePaise }),
      ...(input.freeDeliveryAbovePaise === undefined
        ? {}
        : { freeDeliveryAbovePaise: input.freeDeliveryAbovePaise }),
      ...(input.freeDeliveryRadiusKm === undefined
        ? {}
        : { freeDeliveryRadiusKm: input.freeDeliveryRadiusKm }),
    },
  });
}

// --- Contractor special prices -------------------------------------------

export async function listContractorPrices(query: ContractorPriceQuery) {
  const { page, limit, skip } = parsePagination(query);
  const where: Prisma.ContractorPriceWhereInput = {
    ...(query.contractorId ? { contractorId: query.contractorId } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.contractorPrice.count({ where }),
    prisma.contractorPrice.findMany({
      where,
      include: { product: true },
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return { items, total, page, limit };
}

export async function createContractorPrice(input: ContractorPriceCreateInput) {
  const [contractor, product] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.contractorId },
      select: { id: true, accountType: true },
    }),
    prisma.product.findUnique({ where: { id: input.productId }, select: { id: true } }),
  ]);

  if (!contractor || contractor.accountType !== 'CONTRACTOR') {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Contractor not found');
  }
  if (!product) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Product not found');
  }

  try {
    return await prisma.contractorPrice.create({
      data: {
        contractorId: input.contractorId,
        productId: input.productId,
        pricePaise: input.pricePaise,
        isActive: input.isActive,
      },
      include: { product: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(
        409,
        ErrorCode.CONTRACTOR_PRICE_EXISTS,
        'This contractor already has a special price for this product; edit it instead',
      );
    }
    throw error;
  }
}

export async function updateContractorPrice(id: string, input: ContractorPriceUpdateInput) {
  const existing = await prisma.contractorPrice.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Contractor price not found');
  }

  return prisma.contractorPrice.update({
    where: { id },
    data: {
      ...(input.pricePaise === undefined ? {} : { pricePaise: input.pricePaise }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
    include: { product: true },
  });
}

export async function deleteContractorPrice(id: string): Promise<void> {
  const existing = await prisma.contractorPrice.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Contractor price not found');
  }
  await prisma.contractorPrice.delete({ where: { id } });
}

// --- Bulk quantity discounts ---------------------------------------------

async function assertCategoryAndProduct(input: {
  productId?: string | null;
  categoryId?: string | null;
}): Promise<void> {
  if (input.productId) {
    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true },
    });
    if (!product) throw new ApiError(404, ErrorCode.NOT_FOUND, 'Product not found');
  }
  if (input.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    });
    if (!category) throw new ApiError(404, ErrorCode.NOT_FOUND, 'Category not found');
  }
}

export async function listBulkDiscounts(query: PricingRuleQuery) {
  const { page, limit, skip } = parsePagination(query);
  const where: Prisma.BulkDiscountWhereInput = query.search
    ? { name: { contains: query.search, mode: 'insensitive' } }
    : {};

  const [total, items] = await Promise.all([
    prisma.bulkDiscount.count({ where }),
    prisma.bulkDiscount.findMany({
      where,
      include: { category: true },
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return { items, total, page, limit };
}

export async function createBulkDiscount(input: BulkDiscountCreateInput) {
  await assertCategoryAndProduct(input);
  return prisma.bulkDiscount.create({
    data: {
      name: input.name,
      productId: input.productId ?? null,
      categoryId: input.categoryId ?? null,
      minQuantity: input.minQuantity,
      discountBps: input.discountBps,
      isActive: input.isActive,
    },
    include: { category: true },
  });
}

export async function updateBulkDiscount(id: string, input: BulkDiscountUpdateInput) {
  const existing = await prisma.bulkDiscount.findUnique({
    where: { id },
    select: { id: true, productId: true, categoryId: true },
  });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Bulk discount not found');
  }

  await assertCategoryAndProduct(input);

  const productId = input.productId === undefined ? existing.productId : input.productId;
  const categoryId = input.categoryId === undefined ? existing.categoryId : input.categoryId;
  if (productId && categoryId) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      {
        field: 'categoryId',
        message: 'Scope a discount to one product, one category, or the whole shop - not both',
      },
    ]);
  }

  return prisma.bulkDiscount.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.productId === undefined ? {} : { productId: input.productId }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.minQuantity === undefined ? {} : { minQuantity: input.minQuantity }),
      ...(input.discountBps === undefined ? {} : { discountBps: input.discountBps }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
    include: { category: true },
  });
}

export async function deleteBulkDiscount(id: string): Promise<void> {
  const existing = await prisma.bulkDiscount.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Bulk discount not found');
  }
  await prisma.bulkDiscount.delete({ where: { id } });
}

// --- Contractor percentage rules -----------------------------------------

export async function listContractorRules(query: PricingRuleQuery) {
  const { page, limit, skip } = parsePagination(query);
  const where: Prisma.ContractorRuleWhereInput = query.search
    ? { name: { contains: query.search, mode: 'insensitive' } }
    : {};

  const [total, items] = await Promise.all([
    prisma.contractorRule.count({ where }),
    prisma.contractorRule.findMany({
      where,
      include: { category: true },
      orderBy: [{ createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return { items, total, page, limit };
}

export async function createContractorRule(input: ContractorRuleCreateInput) {
  if (input.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    });
    if (!category) throw new ApiError(404, ErrorCode.NOT_FOUND, 'Category not found');
  }

  return prisma.contractorRule.create({
    data: {
      name: input.name,
      categoryId: input.categoryId ?? null,
      discountBps: input.discountBps,
      isActive: input.isActive,
    },
    include: { category: true },
  });
}

export async function updateContractorRule(id: string, input: ContractorRuleUpdateInput) {
  const existing = await prisma.contractorRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Contractor rule not found');
  }
  if (input.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    });
    if (!category) throw new ApiError(404, ErrorCode.NOT_FOUND, 'Category not found');
  }

  return prisma.contractorRule.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.discountBps === undefined ? {} : { discountBps: input.discountBps }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
    include: { category: true },
  });
}

export async function deleteContractorRule(id: string): Promise<void> {
  const existing = await prisma.contractorRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Contractor rule not found');
  }
  await prisma.contractorRule.delete({ where: { id } });
}
