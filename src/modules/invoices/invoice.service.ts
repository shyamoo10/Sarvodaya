import type { Invoice, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { ErrorCode } from '../../config/error-codes';
import { ApiError } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { buildInvoicePdf } from './invoice.pdf';

type Tx = Prisma.TransactionClient;

/** Next human-friendly invoice number, e.g. SAR-INV-000001. */
async function nextInvoiceNumber(tx: Tx): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { id: 'invoice' },
    update: { value: { increment: 1 } },
    create: { id: 'invoice', value: 1 },
  });
  return `${env.invoice.prefix}-${String(counter.value).padStart(6, '0')}`;
}

/**
 * Creates the invoice inside the checkout transaction, so every order has one.
 *
 * A buyer who gave a GST number gets a TAX_INVOICE, everyone else a BILL. The
 * amounts are the order's frozen totals; this API does not invent tax rates.
 */
export async function createInvoiceForOrder(tx: Tx, orderId: string): Promise<Invoice> {
  const existing = await tx.invoice.findUnique({ where: { orderId } });
  if (existing) return existing;

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { user: { select: { gstNumber: true } } },
  });
  if (!order) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }

  return tx.invoice.create({
    data: {
      orderId: order.id,
      invoiceNumber: await nextInvoiceNumber(tx),
      kind: order.user.gstNumber ? 'TAX_INVOICE' : 'BILL',
      buyerGstNumber: order.user.gstNumber,
      sellerGstNumber: env.invoice.shopGstNumber || null,
      itemTotalPaise: order.itemTotalPaise,
      chargesPaise: order.minOrderChargePaise + order.distanceChargePaise,
      grandTotalPaise: order.grandTotalPaise,
      currency: order.currency,
    },
  });
}

export function serializeInvoice(invoice: Invoice) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    kind: invoice.kind,
    orderId: invoice.orderId,
    buyerGstNumber: invoice.buyerGstNumber,
    sellerGstNumber: invoice.sellerGstNumber,
    itemTotalPaise: invoice.itemTotalPaise,
    chargesPaise: invoice.chargesPaise,
    grandTotalPaise: invoice.grandTotalPaise,
    currency: invoice.currency,
    issuedAt: invoice.issuedAt.toISOString(),
  };
}

async function loadOrderForInvoice(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      user: { select: { id: true, name: true, phone: true, gstNumber: true } },
      invoice: true,
    },
  });
  if (!order) {
    throw new ApiError(404, ErrorCode.NOT_FOUND, 'Order not found');
  }
  return order;
}

/** Every order gets an invoice at checkout; this covers anything older. */
export async function ensureInvoice(orderId: string): Promise<Invoice> {
  const existing = await prisma.invoice.findUnique({ where: { orderId } });
  if (existing) return existing;
  return prisma.$transaction((tx) => createInvoiceForOrder(tx, orderId));
}

export async function getInvoiceForOrder(orderId: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findUnique({ where: { orderId } });
  if (invoice) return invoice;
  return ensureInvoice(orderId);
}

const WAIVED_LABELS: Record<string, string> = {
  MIN_ORDER_CHARGE: 'Minimum order charge',
  DISTANCE_CHARGE: 'Delivery charge',
};

/** Renders the invoice PDF for an order. Access is checked by the route. */
export async function renderInvoicePdf(
  orderId: string,
): Promise<{ buffer: Buffer; invoice: Invoice; fileName: string }> {
  const [order, invoice] = await Promise.all([loadOrderForInvoice(orderId), getInvoiceForOrder(orderId)]);

  const addressLines = [
    order.deliveryLine1,
    order.deliveryLine2,
    order.deliveryLandmark,
    `${order.deliveryCity}, ${order.deliveryState} ${order.deliveryPincode}`,
  ].filter((line): line is string => Boolean(line));

  const buffer = await buildInvoicePdf({
    shop: {
      name: env.invoice.shopName,
      address: env.invoice.shopAddress,
      phone: env.invoice.shopPhone,
      gstNumber: env.invoice.shopGstNumber,
    },
    invoice: {
      number: invoice.invoiceNumber,
      kind: invoice.kind,
      issuedAt: invoice.issuedAt,
    },
    buyer: {
      name: order.user.name,
      phone: order.user.phone,
      addressLines,
      gstNumber: invoice.buyerGstNumber,
    },
    order: {
      orderNumber: order.orderNumber,
      placedAt: order.placedAt,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      deliveryDate: order.deliveryDate,
      deliverySlot: order.deliverySlot,
    },
    items: order.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unit: item.unit,
      unitPricePaise: item.unitPricePaise,
      lineTotalPaise: item.lineTotalPaise,
    })),
    money: {
      itemTotalPaise: order.itemTotalPaise,
      minOrderChargePaise: order.minOrderChargePaise,
      distanceChargePaise: order.distanceChargePaise,
      grandTotalPaise: order.grandTotalPaise,
      waivedCharge:
        order.waivedChargeCode === null
          ? null
          : {
              label: WAIVED_LABELS[order.waivedChargeCode] ?? 'Charge',
              amountPaise: order.waivedChargePaise,
            },
    },
  });

  return {
    buffer,
    invoice,
    fileName: `${invoice.invoiceNumber}.pdf`,
  };
}
