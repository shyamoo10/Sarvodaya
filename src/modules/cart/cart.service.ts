import type { AccountType, Product, ProductUnit } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { getShopSettings, loadPricingContext, priceLine } from '../pricing/pricing.service';
import { quoteDistanceCharge, resolveDeliveryLocation } from '../delivery/delivery.service';
import type { AddCartItemInput } from './cart.schemas';

type CartUser = { id: string; accountType: AccountType };

type ProductWithParent = Product & { category: { parentId: string | null } };

type CartItemWithProduct = {
  id: string;
  productId: string;
  quantity: number;
  createdAt: Date;
  product: ProductWithParent;
};

const MAX_QUANTITY = 999;

function serializeLine(item: CartItemWithProduct, context: Awaited<ReturnType<typeof loadPricingContext>>) {
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
    id: item.id,
    productId: item.productId,
    sku: item.product.sku,
    name: item.product.name,
    brand: item.product.brand,
    sizeVariant: item.product.sizeVariant,
    unit: item.product.unit.toLowerCase() as Lowercase<ProductUnit>,
    photos: item.product.photos,
    quantity: item.quantity,
    originalPricePaise: priced.originalPricePaise,
    unitPricePaise: priced.unitPricePaise,
    lineTotalPaise: priced.unitPricePaise * item.quantity,
    appliedRule: priced.appliedRule,
    inStock: item.product.stockQuantity > 0,
    isAvailable: item.product.isActive,
  };
}

/** One cart per account. Created on first use so a fresh account can add items. */
export async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId } });
}

async function readCart(userId: string) {
  const cart = await getOrCreateCart(userId);
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { createdAt: 'asc' },
    include: { product: { include: { category: { select: { parentId: true } } } } },
  });
  return { cart, items: items as CartItemWithProduct[] };
}

/**
 * Prices the whole cart for one account and one delivery address. Every charge is
 * returned as its own line so the app can show and explain each of them.
 */
export async function buildCartView(user: CartUser, options: { addressId?: string } = {}) {
  const { cart, items } = await readCart(user.id);
  const [settings, context] = await Promise.all([getShopSettings(), loadPricingContext(user)]);

  const lines = items.map((item) => serializeLine(item, context));
  const itemTotalPaise = lines.reduce((total, line) => total + line.lineTotalPaise, 0);
  const totalQuantity = lines.reduce((total, line) => total + line.quantity, 0);

  const isBelowMinimum =
    lines.length > 0 &&
    settings.minOrderAmountPaise > 0 &&
    itemTotalPaise < settings.minOrderAmountPaise;
  const minOrderChargePaise = isBelowMinimum ? settings.minOrderChargePaise : 0;
  const amountToAvoidChargePaise = isBelowMinimum
    ? settings.minOrderAmountPaise - itemTotalPaise
    : 0;

  let delivery: {
    addressId: string | null;
    pincode: string;
    distanceKm: number;
    isFreeDelivery: boolean;
    freeDeliveryReason: 'ORDER_ABOVE_AMOUNT' | 'WITHIN_RADIUS' | null;
  } | null = null;
  let distanceChargePaise = 0;

  if (lines.length > 0) {
    const location = await resolveDeliveryLocation(user.id, cart.deliveryAddressId, options.addressId);

    if (location) {
      const quote = await quoteDistanceCharge(itemTotalPaise, location, settings);

      distanceChargePaise = quote.chargePaise;
      delivery = {
        addressId: location.addressId,
        pincode: location.pincode,
        distanceKm: quote.distanceKm,
        isFreeDelivery: quote.isFreeDelivery,
        freeDeliveryReason: quote.freeDeliveryReason,
      };
    }
  }

  return {
    cartId: cart.id,
    items: lines,
    itemCount: lines.length,
    totalQuantity,
    itemTotalPaise,
    charges: [
      {
        code: 'ITEM_TOTAL',
        label: 'Item total',
        amountPaise: itemTotalPaise,
        amountToAvoidChargePaise: null,
      },
      {
        code: 'MIN_ORDER_CHARGE',
        label: 'Minimum order charge',
        amountPaise: minOrderChargePaise,
        amountToAvoidChargePaise: isBelowMinimum ? amountToAvoidChargePaise : null,
      },
      {
        code: 'DISTANCE_CHARGE',
        label: 'Delivery charge',
        amountPaise: distanceChargePaise,
        amountToAvoidChargePaise: null,
      },
    ],
    minOrder: {
      thresholdPaise: settings.minOrderAmountPaise,
      chargePaise: settings.minOrderChargePaise,
      isBelowThreshold: isBelowMinimum,
      amountToAvoidChargePaise: isBelowMinimum ? amountToAvoidChargePaise : null,
    },
    delivery,
    /// True while the account has no address: the app should ask for one before
    /// quoting delivery, since the distance charge is not part of the total yet.
    requiresDeliveryAddress: lines.length > 0 && delivery === null,
    grandTotalPaise: itemTotalPaise + minOrderChargePaise + distanceChargePaise,
    currency: 'INR',
    updatedAt: cart.updatedAt.toISOString(),
  };
}

async function assertCartItem(cartId: string, itemId: string) {
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId } });
  if (!item) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Cart item not found');
  }
  return item;
}

export async function addCartItem(user: CartUser, input: AddCartItemInput) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, isActive: true },
  });
  if (!product || !product.isActive) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Product not found');
  }

  const cart = await getOrCreateCart(user.id);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId: input.productId } },
  });

  const quantity = (existing?.quantity ?? 0) + input.quantity;
  if (quantity > MAX_QUANTITY) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
      { field: 'quantity', message: `Quantity cannot be more than ${MAX_QUANTITY}` },
    ]);
  }

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId: input.productId } },
    update: { quantity },
    create: { cartId: cart.id, productId: input.productId, quantity },
  });

  return buildCartView(user);
}

export async function updateCartItem(
  user: CartUser,
  itemId: string,
  quantity: number,
) {
  const cart = await getOrCreateCart(user.id);
  await assertCartItem(cart.id, itemId);

  await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
  return buildCartView(user);
}

export async function removeCartItem(user: CartUser, itemId: string) {
  const cart = await getOrCreateCart(user.id);
  await assertCartItem(cart.id, itemId);

  await prisma.cartItem.delete({ where: { id: itemId } });
  return buildCartView(user);
}

export async function clearCart(user: CartUser) {
  const cart = await getOrCreateCart(user.id);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return buildCartView(user);
}

/** Remembers the delivery address chosen for this cart. Pass null to clear it. */
export async function setDeliveryAddress(user: CartUser, addressId: string | null) {
  const cart = await getOrCreateCart(user.id);

  if (addressId) {
    const address = await prisma.address.findFirst({
      where: { id: addressId, userId: user.id },
      select: { id: true },
    });
    if (!address) {
      throw new ApiError(404, ErrorCode.NOT_FOUND, 'Address not found');
    }
  }

  await prisma.cart.update({ where: { id: cart.id }, data: { deliveryAddressId: addressId } });
  return buildCartView(user);
}
