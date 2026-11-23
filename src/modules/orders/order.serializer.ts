import type {
  Order,
  OrderItem,
  OrderStatusHistory,
  Payment,
  ProductUnit,
} from '@prisma/client';

type StatusChange = OrderStatusHistory & { changedBy?: { id: string; name: string } | null };

export type OrderForView = Order & {
  items: OrderItem[];
  statusHistory: StatusChange[];
  payments: Payment[];
};

const METHOD_LABELS = {
  ONLINE: 'Online payment',
  CASH_ON_DELIVERY: 'Cash on delivery',
  CREDIT: 'Pay later',
} as const;

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function serializeOrderItem(item: OrderItem) {
  return {
    id: item.id,
    productId: item.productId,
    sku: item.sku,
    name: item.name,
    brand: item.brand,
    sizeVariant: item.sizeVariant,
    unit: item.unit.toLowerCase() as Lowercase<ProductUnit>,
    photos: item.photos,
    quantity: item.quantity,
    originalPricePaise: item.originalPricePaise,
    unitPricePaise: item.unitPricePaise,
    lineTotalPaise: item.lineTotalPaise,
    appliedRule: {
      type: item.appliedRuleType,
      id: item.appliedRuleId,
      label: item.appliedRuleLabel,
    },
  };
}

export function serializeStatusChange(change: StatusChange) {
  return {
    fromStatus: change.fromStatus,
    toStatus: change.toStatus,
    note: change.note,
    changedBy: change.changedBy ? { id: change.changedBy.id, name: change.changedBy.name } : null,
    at: change.createdAt.toISOString(),
  };
}

export function serializePayment(payment: Payment) {
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    amountPaise: payment.amountPaise,
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
    signatureVerified: payment.razorpaySignatureVerified,
    note: payment.note,
    receivedAt: payment.receivedAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
  };
}

/**
 * One order as the app sees it. Prices, charges and the delivery address are the
 * frozen copies taken at checkout, never recomputed from today's catalogue.
 */
export function serializeOrder(order: OrderForView, options: { includeAdmin?: boolean } = {}) {
  const amountDuePaise = Math.max(0, order.grandTotalPaise - order.amountPaidPaise);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.placedAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    payment: {
      method: order.paymentMethod,
      methodLabel: METHOD_LABELS[order.paymentMethod],
      status: order.paymentStatus,
      amountPaidPaise: order.amountPaidPaise,
      amountDuePaise,
      isPayLater: order.paymentMethod === 'CREDIT',
      canPayOnline:
        order.paymentMethod === 'ONLINE' && order.status !== 'CANCELLED' && amountDuePaise > 0,
    },
    money: {
      itemTotalPaise: order.itemTotalPaise,
      minOrderChargePaise: order.minOrderChargePaise,
      distanceChargePaise: order.distanceChargePaise,
      waivedCharge:
        order.waivedChargeCode === null
          ? null
          : {
              code: order.waivedChargeCode,
              amountPaise: order.waivedChargePaise,
              note: order.waivedChargeNote,
            },
      grandTotalPaise: order.grandTotalPaise,
      currency: order.currency,
    },
    delivery: {
      addressId: order.deliveryAddressId,
      contactName: order.deliveryContactName,
      contactPhone: order.deliveryContactPhone,
      line1: order.deliveryLine1,
      line2: order.deliveryLine2,
      landmark: order.deliveryLandmark,
      city: order.deliveryCity,
      state: order.deliveryState,
      pincode: order.deliveryPincode,
      distanceKm: order.distanceKm,
      requestedDate: dateOnly(order.deliveryDate),
      slot: order.deliverySlot,
      notes: order.notes,
    },
    items: order.items.map(serializeOrderItem),
    timeline: order.statusHistory.map(serializeStatusChange),
    ...(options.includeAdmin
      ? {
          customer: {
            id: order.userId,
          },
          payments: order.payments.map(serializePayment),
        }
      : {}),
  };
}
