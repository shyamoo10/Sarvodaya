import type { OrderStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { DashboardQuery } from './dashboard.schemas';

const PENDING_STATUSES: OrderStatus[] = ['CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY'];

export type DashboardOrder = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  placedAt: Date;
  deliveryDate: Date | null;
  deliverySlot: string | null;
  pincode: string;
  grandTotalPaise: number;
  customerName: string;
  customerPhone: string;
};

function serializeDashboardOrder(order: DashboardOrder) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.placedAt.toISOString(),
    requestedDeliveryDate: order.deliveryDate?.toISOString().slice(0, 10) ?? null,
    deliverySlot: order.deliverySlot,
    pincode: order.pincode,
    grandTotalPaise: order.grandTotalPaise,
    customer: { name: order.customerName, phone: order.customerPhone },
  };
}

/**
 * The owner's opening screen: what came in today, what still has to go out, what
 * is running low and how much cash-on-delivery money is still out there.
 *
 * Every number is read from the database on each call — nothing is cached, so the
 * dashboard never shows a stale total.
 */
export async function getAdminDashboard(query: DashboardQuery) {
  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const [todayOrders, pendingCount, pendingOrders, lowStockCount, lowStockProducts, codOrders] =
    await Promise.all([
      prisma.order.findMany({
        where: { placedAt: { gte: todayStart } },
        select: { status: true, grandTotalPaise: true, amountPaidPaise: true },
      }),
      prisma.order.count({ where: { status: { in: PENDING_STATUSES } } }),
      prisma.order.findMany({
        where: { status: { in: PENDING_STATUSES } },
        orderBy: [{ deliveryDate: 'asc' }, { placedAt: 'asc' }],
        take: query.pendingLimit,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          placedAt: true,
          deliveryDate: true,
          deliverySlot: true,
          deliveryPincode: true,
          grandTotalPaise: true,
          deliveryContactName: true,
          deliveryContactPhone: true,
        },
      }),
      prisma.product.count({ where: { isActive: true, stockQuantity: { lte: query.lowStockThreshold } } }),
      prisma.product.findMany({
        where: { isActive: true, stockQuantity: { lte: query.lowStockThreshold } },
        orderBy: [{ stockQuantity: 'asc' }, { name: 'asc' }],
        take: 20,
        select: {
          id: true,
          sku: true,
          name: true,
          brand: true,
          unit: true,
          stockQuantity: true,
          category: { select: { name: true } },
        },
      }),
      prisma.order.findMany({
        where: {
          paymentMethod: 'CASH_ON_DELIVERY',
          status: { not: 'CANCELLED' },
          paymentStatus: { not: 'PAID' },
        },
        select: { grandTotalPaise: true, amountPaidPaise: true },
      }),
    ]);

  const salesTodayPaise = todayOrders
    .filter((order) => order.status !== 'CANCELLED')
    .reduce((total, order) => total + order.grandTotalPaise, 0);

  const byStatus = todayOrders.reduce<Record<string, number>>((counts, order) => {
    counts[order.status] = (counts[order.status] ?? 0) + 1;
    return counts;
  }, {});

  const codOutstandingPaise = codOrders.reduce(
    (total, order) => total + Math.max(0, order.grandTotalPaise - order.amountPaidPaise),
    0,
  );

  return {
    generatedAt: now.toISOString(),
    today: {
      date: todayStart.toISOString().slice(0, 10),
      orders: todayOrders.length,
      cancelledOrders: todayOrders.filter((order) => order.status === 'CANCELLED').length,
      salesPaise: salesTodayPaise,
      byStatus,
    },
    pendingDeliveries: {
      count: pendingCount,
      orders: pendingOrders.map((order) =>
        serializeDashboardOrder({
          ...order,
          pincode: order.deliveryPincode,
          customerName: order.deliveryContactName,
          customerPhone: order.deliveryContactPhone,
        }),
      ),
    },
    lowStock: {
      threshold: query.lowStockThreshold,
      count: lowStockCount,
      products: lowStockProducts.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        category: product.category.name,
        unit: product.unit.toLowerCase(),
        stockQuantity: product.stockQuantity,
      })),
    },
    cashOnDelivery: {
      orders: codOrders.length,
      outstandingPaise: codOutstandingPaise,
    },
  };
}
