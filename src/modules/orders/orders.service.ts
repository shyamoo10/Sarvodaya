import { Prisma, type AccountType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError, parsePagination } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { getShopSettings, loadPricingContext, priceLine } from '../pricing/pricing.service';
import { quoteDistanceCharge } from '../delivery/delivery.service';
import { outstandingCreditPaise } from '../credit/credit.service';
import type {
  AdminOrderListQuery,
  CheckoutInput,
  OrderListQuery,
} from './order.schemas';
import type { OrderForView } from './order.serializer';

export const MAX_QUANTITY = 999;
const IDEMPOTENCY_MIN_LENGTH = 8;
const IDEMPOTENCY_MAX_LENGTH = 128;

export type OrderUser = { id: string; accountType: AccountType };

export const orderInclude = {
  items: { orderBy: { createdAt: 'asc' } },
  statusHistory: {
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { id: true, name: true } } },
  },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

export async function findOrderWithRelations(id: string): Promise<OrderForView> {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }
  return order;
}

export async function getOrderForUser(user: OrderUser, orderId: string): Promise<OrderForView> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(user.accountType === 'ADMIN' ? {} : { userId: user.id }) },
    include: orderInclude,
  });
  if (!order) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }
  return order;
}

/** Prices the stored cart and quotes delivery for the chosen address, raising the
 * same polite pincode / range errors as the cart does. */
async function readCheckoutDraft(user: OrderUser, input: CheckoutInput) {
  const cart = await prisma.cart.findUnique({
    where: { userId: user.id },
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
        include: { product: { include: { category: { select: { parentId: true } } } } },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    throw new ApiError(
      400,
      ErrorCode.CART_EMPTY,
      'Your cart is empty. Add at least one product before placing an order.',
    );
  }

  const address = input.addressId
    ? await prisma.address.findFirst({ where: { id: input.addressId, userId: user.id } })
    : await prisma.address.findFirst({
        where: { userId: user.id },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });

  if (!address) {
    if (input.addressId) {
      throw new ApiError(404, ErrorCode.NOT_FOUND, 'Address not found');
    }
    throw new ApiError(
      400,
      ErrorCode.DELIVERY_ADDRESS_REQUIRED,
      'Please add a delivery address before placing the order.',
    );
  }

  const approved = await prisma.serviceablePincode.findUnique({
    where: { pincode: address.pincode },
  });
  if (!approved || !approved.isActive) {
    throw new ApiError(
      400,
      ErrorCode.PINCODE_NOT_SERVICEABLE,
      `Sorry, we do not deliver to pincode ${address.pincode} yet. Please choose another delivery address or contact the shop.`,
      { pincode: address.pincode },
    );
  }

  const [settings, context] = await Promise.all([getShopSettings(), loadPricingContext(user)]);

  const unavailable: { field: string; message: string }[] = [];
  const lines = cart.items.map((item) => {
    if (!item.product.isActive) {
      unavailable.push({
        field: `items.${item.product.sku}`,
        message: `${item.product.name} is no longer available. Remove it from the cart to continue.`,
      });
    }

    const priced = priceLine(
      {
        id: item.product.id,
        categoryId: item.product.categoryId,
        pricePaise: item.product.pricePaise,
        category: { parentId: item.product.category.parentId },
      },
      item.quantity,
      context,
    );

    return {
      productId: item.product.id,
      sku: item.product.sku,
      name: item.product.name,
      brand: item.product.brand,
      sizeVariant: item.product.sizeVariant,
      unit: item.product.unit,
      photos: item.product.photos,
      quantity: item.quantity,
      availableStock: item.product.stockQuantity,
      originalPricePaise: priced.originalPricePaise,
      unitPricePaise: priced.unitPricePaise,
      lineTotalPaise: priced.unitPricePaise * item.quantity,
      appliedRuleType: priced.appliedRule.type,
      appliedRuleId: priced.appliedRule.id,
      appliedRuleLabel: priced.appliedRule.label,
    };
  });

  if (unavailable.length > 0) {
    throw new ApiError(
      400,
      ErrorCode.PRODUCT_UNAVAILABLE,
      'Some items in your cart are no longer available.',
      unavailable,
    );
  }

  const itemTotalPaise = lines.reduce((total, line) => total + line.lineTotalPaise, 0);
  const isBelowMinimum =
    settings.minOrderAmountPaise > 0 && itemTotalPaise < settings.minOrderAmountPaise;
  const minOrderChargePaise = isBelowMinimum ? settings.minOrderChargePaise : 0;

  const quote = await quoteDistanceCharge(
    itemTotalPaise,
    {
      latitude: address.latitude ?? approved.latitude,
      longitude: address.longitude ?? approved.longitude,
    },
    settings,
  );

  const grandTotalPaise = itemTotalPaise + minOrderChargePaise + quote.chargePaise;

  return { cart, address, lines, itemTotalPaise, minOrderChargePaise, quote, grandTotalPaise };
}

function assertDeliveryDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      { field: 'deliveryDate', message: 'Use the date format YYYY-MM-DD' },
    ]);
  }
  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (parsed < todayUtc) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      { field: 'deliveryDate', message: 'Choose today or a later delivery date' },
    ]);
  }
  return parsed;
}

/**
 * Turns the stored cart into an order.
 *
 * Everything happens in one database transaction: the order, its lines, the
 * status history, the stock reduction and clearing the cart. Stock is reduced
 * with a conditional UPDATE (`stockQuantity >= quantity`), so two buyers racing
 * for the last bag of cement can never both succeed.
 *
 * An `Idempotency-Key` makes checkout safe to retry: the same key returns the
 * order created the first time instead of placing a second one.
 */
export async function checkout(
  user: OrderUser,
  input: CheckoutInput,
  idempotencyKey?: string,
): Promise<{ order: OrderForView; replayed: boolean }> {
  const key = idempotencyKey?.trim() || null;
  if (key && (key.length < IDEMPOTENCY_MIN_LENGTH || key.length > IDEMPOTENCY_MAX_LENGTH)) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      {
        field: 'Idempotency-Key',
        message: `Use a key between ${IDEMPOTENCY_MIN_LENGTH} and ${IDEMPOTENCY_MAX_LENGTH} characters`,
      },
    ]);
  }

  if (key) {
    const existing = await prisma.order.findFirst({
      where: { userId: user.id, idempotencyKey: key },
      include: orderInclude,
    });
    if (existing) {
      return { order: existing, replayed: true };
    }
  }

  const deliveryDate = assertDeliveryDate(input.deliveryDate);
  const draft = await readCheckoutDraft(user, input);

  if (input.paymentMethod === 'CREDIT') {
    if (user.accountType !== 'CONTRACTOR') {
      throw new ApiError(
        403,
        ErrorCode.CREDIT_NOT_AVAILABLE,
        'Pay later is only available to contractor accounts.',
      );
    }
    const terms = await prisma.creditTerms.findUnique({ where: { contractorId: user.id } });
    if (!terms || !terms.isEnabled) {
      throw new ApiError(
        403,
        ErrorCode.CREDIT_NOT_AVAILABLE,
        'Pay later has not been enabled for your account. Please contact the shop or pay on delivery.',
      );
    }
    if (terms.creditLimitPaise !== null) {
      const outstanding = await outstandingCreditPaise(user.id);
      if (outstanding + draft.grandTotalPaise > terms.creditLimitPaise) {
        throw new ApiError(
          400,
          ErrorCode.CREDIT_LIMIT_EXCEEDED,
          'This order is above your remaining credit limit. Please contact the shop or choose another payment method.',
          {
            creditLimitPaise: terms.creditLimitPaise,
            outstandingPaise: outstanding,
            availablePaise: Math.max(0, terms.creditLimitPaise - outstanding),
          },
        );
      }
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // A single counter row hands out human-friendly order numbers without gaps.
      const counter = await tx.counter.upsert({
        where: { id: 'order' },
        update: { value: { increment: 1 } },
        create: { id: 'order', value: 1 },
      });
      const orderNumber = `SAR-${String(counter.value).padStart(6, '0')}`;

      const order = await tx.order.create({
        data: {
          orderNumber,
          userId: user.id,
          status: 'CONFIRMED',
          paymentMethod: input.paymentMethod,
          paymentStatus: 'PENDING',
          itemTotalPaise: draft.itemTotalPaise,
          minOrderChargePaise: draft.minOrderChargePaise,
          distanceChargePaise: draft.quote.chargePaise,
          grandTotalPaise: draft.grandTotalPaise,
          deliveryAddressId: draft.address.id,
          deliveryContactName: draft.address.contactName,
          deliveryContactPhone: draft.address.contactPhone,
          deliveryLine1: draft.address.line1,
          deliveryLine2: draft.address.line2,
          deliveryLandmark: draft.address.landmark,
          deliveryCity: draft.address.city,
          deliveryState: draft.address.state,
          deliveryPincode: draft.address.pincode,
          distanceKm: draft.quote.distanceKm,
          deliveryDate,
          deliverySlot: input.deliverySlot ?? null,
          notes: input.notes ?? null,
          idempotencyKey: key,
        },
      });

      await tx.orderItem.createMany({
        data: draft.lines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          brand: line.brand,
          sizeVariant: line.sizeVariant,
          unit: line.unit,
          photos: line.photos,
          quantity: line.quantity,
          originalPricePaise: line.originalPricePaise,
          unitPricePaise: line.unitPricePaise,
          lineTotalPaise: line.lineTotalPaise,
          appliedRuleType: line.appliedRuleType,
          appliedRuleId: line.appliedRuleId,
          appliedRuleLabel: line.appliedRuleLabel,
        })),
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          toStatus: 'CONFIRMED',
          changedById: user.id,
          note: 'Order placed',
        },
      });

      for (const line of draft.lines) {
        // Conditional update: the row is only changed while enough stock is left,
        // so the last item can never be sold twice.
        const updated = await tx.$executeRaw`
          UPDATE "Product"
             SET "stockQuantity" = "stockQuantity" - ${line.quantity}
           WHERE "id" = ${line.productId}::uuid
             AND "stockQuantity" >= ${line.quantity}
        `;

        if (updated === 0) {
          // Re-read inside the transaction for the true figure: another buyer may
          // have taken the stock between pricing and this update.
          const fresh = await tx.product.findUnique({
            where: { id: line.productId },
            select: { stockQuantity: true },
          });
          const availableQuantity = Math.max(0, fresh?.stockQuantity ?? 0);

          throw new ApiError(
            409,
            ErrorCode.INSUFFICIENT_STOCK,
            `Sorry, only ${availableQuantity} ${line.unit.toLowerCase()} of ${line.name} is left. Please reduce the quantity.`,
            {
              productId: line.productId,
              sku: line.sku,
              requestedQuantity: line.quantity,
              availableQuantity,
            },
          );
        }
      }

      await tx.cartItem.deleteMany({ where: { cartId: draft.cart.id } });

      return order;
    });

    return { order: await findOrderWithRelations(created.id), replayed: false };
  } catch (error) {
    // Two identical requests arriving together: the unique key lets one win and
    // the other gets the very same order back.
    if (
      key &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await prisma.order.findFirst({
        where: { userId: user.id, idempotencyKey: key },
        include: orderInclude,
      });
      if (existing) {
        return { order: existing, replayed: true };
      }
    }
    throw error;
  }
}

function buildOrderWhere(
  user: OrderUser,
  query: OrderListQuery & Partial<AdminOrderListQuery>,
): Prisma.OrderWhereInput {
  const isAdmin = user.accountType === 'ADMIN';
  const placedAt: Prisma.DateTimeFilter = {};
  if (query.from) placedAt.gte = new Date(`${query.from}T00:00:00.000Z`);
  if (query.to) placedAt.lt = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000);

  return {
    ...(isAdmin && query.userId ? { userId: query.userId } : {}),
    ...(isAdmin ? {} : { userId: user.id }),
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(isAdmin && query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
    ...(query.from || query.to ? { placedAt } : {}),
    ...(isAdmin && query.search
      ? {
          OR: [
            { orderNumber: { contains: query.search, mode: 'insensitive' as const } },
            { user: { phone: { contains: query.search } } },
            { user: { name: { contains: query.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
}

export async function listOrders(
  user: OrderUser,
  query: OrderListQuery & Partial<AdminOrderListQuery>,
) {
  const { page, limit, skip } = parsePagination(query);
  const where = buildOrderWhere(user, query);

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: [{ placedAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return { orders, total, page, limit };
}
