import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { buildCartView, getOrCreateCart } from '../cart/cart.service';
import { findOrderWithRelations, MAX_QUANTITY, type OrderUser } from './orders.service';
import {
  queueOrderNotifications,
  STATUS_EVENT,
} from '../notifications/notification.service';
import type {
  CancelOrderInput,
  RecordPaymentInput,
  UpdateOrderStatusInput,
  WaiveChargeInput,
} from './order.schemas';
import type { OrderForView } from './order.serializer';

/** Statuses an order can move to from each status. Cancelling has its own path. */
const STATUS_FLOW: Record<string, string[]> = {
  CONFIRMED: ['PACKED'],
  PACKED: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * Cancels an order and puts its stock back. A customer can cancel only while the
 * order is still CONFIRMED; the admin can cancel anything that has not been
 * delivered yet.
 */
export async function cancelOrder(
  user: OrderUser,
  orderId: string,
  input: CancelOrderInput = {},
): Promise<OrderForView> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order || (user.accountType !== 'ADMIN' && order.userId !== user.id)) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }

  if (order.status === 'CANCELLED') {
    throw new ApiError(409, ErrorCode.ORDER_ALREADY_CANCELLED, 'This order is already cancelled');
  }
  if (order.status === 'DELIVERED') {
    throw new ApiError(
      409,
      ErrorCode.INVALID_ORDER_STATUS_CHANGE,
      'A delivered order cannot be cancelled. Please contact the shop.',
    );
  }
  if (user.accountType !== 'ADMIN' && order.status !== 'CONFIRMED') {
    throw new ApiError(
      409,
      ErrorCode.INVALID_ORDER_STATUS_CHANGE,
      'This order is already being prepared. Please contact the shop to cancel it.',
    );
  }

  const reason = input.reason?.trim() || null;

  await prisma.$transaction(async (tx) => {
    // Restoring stock is an increment, so it cannot fail even if the product was
    // hidden in the meantime; a deleted product simply has nothing to restore.
    for (const item of order.items) {
      if (!item.productId) continue;
      await tx.product.updateMany({
        where: { id: item.productId },
        data: { stockQuantity: { increment: item.quantity } },
      });
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'CANCELLED',
        note:
          reason ??
          (user.accountType === 'ADMIN' ? 'Cancelled by the shop' : 'Cancelled by the customer'),
        changedById: user.id,
      },
    });
  });

  return findOrderWithRelations(order.id);
}

/** Admin-only status change, recorded in the order's history. */
export async function updateOrderStatus(
  user: OrderUser,
  orderId: string,
  input: UpdateOrderStatusInput,
): Promise<OrderForView> {
  if (input.status === 'CANCELLED') {
    return cancelOrder(user, orderId, { reason: input.note });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }

  const allowed = STATUS_FLOW[order.status] ?? [];
  if (!allowed.includes(input.status)) {
    throw new ApiError(
      409,
      ErrorCode.INVALID_ORDER_STATUS_CHANGE,
      order.status === 'CANCELLED'
        ? 'A cancelled order cannot change status'
        : order.status === 'DELIVERED'
          ? 'This order is already delivered'
          : `An order that is ${order.status.toLowerCase().replace(/_/g, ' ')} cannot move to ${input.status
              .toLowerCase()
              .replace(/_/g, ' ')}`,
      { fromStatus: order.status, toStatus: input.status, allowedNextStatuses: allowed },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: input.status } });
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: input.status,
        note: input.note ?? null,
        changedById: user.id,
      },
    });
  });

  // The customer hears about packing, dispatch and delivery. Duplicate events are
  // impossible: the queue dedupes on order, event and channel.
  const event = STATUS_EVENT[input.status];
  if (event) {
    await queueOrderNotifications(order.id, event);
  }

  return findOrderWithRelations(order.id);
}

/**
 * Waives one charge on one order, never on the shop settings, so every other
 * order keeps the normal charge.
 */
export async function waiveCharge(
  user: OrderUser,
  orderId: string,
  input: WaiveChargeInput,
): Promise<OrderForView> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }
  if (order.status === 'CANCELLED') {
    throw new ApiError(
      409,
      ErrorCode.INVALID_ORDER_STATUS_CHANGE,
      'A cancelled order cannot change',
    );
  }
  if (order.waivedChargeCode !== null) {
    throw new ApiError(
      409,
      ErrorCode.CHARGE_ALREADY_WAIVED,
      `A charge was already waived on this order (${order.waivedChargeCode}).`,
    );
  }

  const amountPaise =
    input.charge === 'MIN_ORDER_CHARGE' ? order.minOrderChargePaise : order.distanceChargePaise;
  if (amountPaise === 0) {
    throw new ApiError(
      409,
      ErrorCode.CHARGE_ALREADY_WAIVED,
      'That charge is already zero on this order',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        ...(input.charge === 'MIN_ORDER_CHARGE'
          ? { minOrderChargePaise: 0 }
          : { distanceChargePaise: 0 }),
        waivedChargeCode: input.charge,
        waivedChargePaise: amountPaise,
        waivedChargeNote: input.note ?? null,
        grandTotalPaise: order.grandTotalPaise - amountPaise,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status,
        note: `${input.charge === 'MIN_ORDER_CHARGE' ? 'Minimum order charge' : 'Delivery charge'} waived (${amountPaise} paise)${input.note ? `: ${input.note}` : ''}`,
        changedById: user.id,
      },
    });
  });

  return findOrderWithRelations(order.id);
}

/** Records money the shop received, for example cash on delivery. Partial amounts
 * are allowed and move the order to PARTIALLY_PAID. */
export async function recordPayment(
  user: OrderUser,
  orderId: string,
  input: RecordPaymentInput,
): Promise<OrderForView> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }
  if (order.status === 'CANCELLED') {
    throw new ApiError(
      409,
      ErrorCode.INVALID_ORDER_STATUS_CHANGE,
      'A cancelled order cannot receive a payment',
    );
  }

  const due = order.grandTotalPaise - order.amountPaidPaise;
  if (due <= 0) {
    throw new ApiError(409, ErrorCode.PAYMENT_ALREADY_SETTLED, 'This order is already fully paid');
  }
  if (input.amountPaise > due) {
    throw new ApiError(
      400,
      ErrorCode.PAYMENT_AMOUNT_INVALID,
      `Only ${due} paise is due on this order`,
      { amountDuePaise: due },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: 'CASH',
        status: 'SUCCEEDED',
        amountPaise: input.amountPaise,
        note: input.note ?? null,
        receivedAt: new Date(),
        recordedById: user.id,
      },
    });
    await syncOrderPayments(tx, order.id);
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status,
        note: `Payment received: ${input.amountPaise} paise${input.note ? ` (${input.note})` : ''}`,
        changedById: user.id,
      },
    });
  });

  return findOrderWithRelations(order.id);
}

/** Recomputes the order's payment status from its successful payments. */
export async function syncOrderPayments(
  tx: { order: Prisma.TransactionClient['order']; payment: Prisma.TransactionClient['payment'] },
  orderId: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { grandTotalPaise: true },
  });
  if (!order) return;

  const aggregate = await tx.payment.aggregate({
    where: { orderId, status: 'SUCCEEDED' },
    _sum: { amountPaise: true },
  });
  const paid = aggregate._sum.amountPaise ?? 0;
  const paymentStatus =
    paid >= order.grandTotalPaise && order.grandTotalPaise > 0
      ? 'PAID'
      : paid > 0
        ? 'PARTIALLY_PAID'
        : 'PENDING';

  await tx.order.update({
    where: { id: orderId },
    data: { amountPaidPaise: paid, paymentStatus },
  });
}

/** Puts the order's items back in the cart, skipping anything the shop has hidden. */
export async function reorder(
  user: OrderUser,
  orderId: string,
  maxQuantity?: number,
): Promise<{
  cart: Awaited<ReturnType<typeof buildCartView>>;
  added: number;
  skipped: { sku: string; name: string; reason: string }[];
}> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
    include: { items: true },
  });
  if (!order) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }

  const cart = await getOrCreateCart(user.id);
  const skipped: { sku: string; name: string; reason: string }[] = [];
  let added = 0;

  for (const item of order.items) {
    if (!item.productId) {
      skipped.push({ sku: item.sku, name: item.name, reason: 'PRODUCT_REMOVED' });
      continue;
    }

    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      select: { id: true, isActive: true },
    });
    if (!product || !product.isActive) {
      skipped.push({ sku: item.sku, name: item.name, reason: 'UNAVAILABLE' });
      continue;
    }

    const wanted = Math.min(item.quantity, maxQuantity ?? MAX_QUANTITY, MAX_QUANTITY);
    const existing = await prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId: item.productId } },
    });
    const quantity = Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + wanted);

    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: item.productId } },
      update: { quantity },
      create: { cartId: cart.id, productId: item.productId, quantity },
    });
    added += 1;
  }

  return { cart: await buildCartView(user), added, skipped };
}
