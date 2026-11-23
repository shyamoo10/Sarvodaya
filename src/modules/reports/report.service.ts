import ExcelJS from 'exceljs';
import { ErrorCode } from '../../config/error-codes';
import { ApiError } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import type { OrderReportQuery, ReportRangeQuery } from './report.schemas';

/** Rupees in a spreadsheet, from paise in the database. */
function rupees(paise: number): number {
  return Math.round(paise) / 100;
}

function resolveRange(query: ReportRangeQuery): { from: Date; to: Date } {
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(to.getTime() - 30 * 86_400_000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
    throw new ApiError(400, ErrorCode.REPORT_RANGE_INVALID, 'The report date range is not valid');
  }
  return { from, to };
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * One row per order line, so the owner can total by product or by order in Excel.
 * Money is written in rupees because that is what a spreadsheet should hold.
 */
export async function buildSalesReport(query: ReportRangeQuery): Promise<{
  buffer: Buffer;
  fileName: string;
  rows: number;
}> {
  const { from, to } = resolveRange(query);

  const orders = await prisma.order.findMany({
    where: { placedAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
    orderBy: [{ placedAt: 'asc' }, { orderNumber: 'asc' }],
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      user: { select: { name: true, phone: true } },
    },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sarvodaya';
  const sheet = workbook.addWorksheet('Sales');

  sheet.columns = [
    { header: 'Order number', key: 'orderNumber', width: 18 },
    { header: 'Placed at', key: 'placedAt', width: 20 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Product', key: 'product', width: 30 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Unit price (INR)', key: 'unitPrice', width: 16 },
    { header: 'Line total (INR)', key: 'lineTotal', width: 16 },
    { header: 'Order total (INR)', key: 'orderTotal', width: 18 },
    { header: 'Amount paid (INR)', key: 'amountPaid', width: 18 },
    { header: 'Payment method', key: 'paymentMethod', width: 18 },
    { header: 'Payment status', key: 'paymentStatus', width: 16 },
  ];
  styleHeader(sheet);

  let rows = 0;
  for (const order of orders) {
    for (const item of order.items) {
      sheet.addRow({
        orderNumber: order.orderNumber,
        placedAt: order.placedAt.toISOString(),
        status: order.status,
        customer: order.user.name,
        phone: order.user.phone,
        sku: item.sku,
        product: item.name,
        unit: item.unit.toLowerCase(),
        quantity: item.quantity,
        unitPrice: rupees(item.unitPricePaise),
        lineTotal: rupees(item.lineTotalPaise),
        orderTotal: rupees(order.grandTotalPaise),
        amountPaid: rupees(order.amountPaidPaise),
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
      });
      rows += 1;
    }
  }

  sheet.getColumn('unitPrice').numFmt = '#,##0.00';
  sheet.getColumn('lineTotal').numFmt = '#,##0.00';
  sheet.getColumn('orderTotal').numFmt = '#,##0.00';
  sheet.getColumn('amountPaid').numFmt = '#,##0.00';

  const totals = workbook.addWorksheet('Totals');
  totals.columns = [
    { header: 'Report', key: 'label', width: 30 },
    { header: 'Value', key: 'value', width: 24 },
  ];
  styleHeader(totals);
  totals.addRow({ label: 'From', value: from.toISOString().slice(0, 10) });
  totals.addRow({ label: 'To', value: to.toISOString().slice(0, 10) });
  totals.addRow({ label: 'Orders', value: orders.length });
  totals.addRow({
    label: 'Order value (INR)',
    value: rupees(orders.reduce((sum, order) => sum + order.grandTotalPaise, 0)),
  });
  totals.addRow({
    label: 'Collected (INR)',
    value: rupees(orders.reduce((sum, order) => sum + order.amountPaidPaise, 0)),
  });
  totals.addRow({ label: 'Line items', value: rows });

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    fileName: `sales-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.xlsx`,
    rows,
  };
}

/** One row per order: what was ordered, what it cost and how it will be paid. */
export async function buildOrderReport(query: OrderReportQuery): Promise<{
  buffer: Buffer;
  fileName: string;
  rows: number;
}> {
  const { from, to } = resolveRange(query);

  const orders = await prisma.order.findMany({
    where: {
      placedAt: { gte: from, lte: to },
      ...(query.status ? { status: query.status } : {}),
    },
    orderBy: [{ placedAt: 'asc' }, { orderNumber: 'asc' }],
    include: {
      items: { select: { quantity: true } },
      user: { select: { name: true, phone: true } },
      invoice: { select: { invoiceNumber: true, kind: true } },
    },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sarvodaya';
  const sheet = workbook.addWorksheet('Orders');

  sheet.columns = [
    { header: 'Order number', key: 'orderNumber', width: 18 },
    { header: 'Placed at', key: 'placedAt', width: 20 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Delivery date', key: 'deliveryDate', width: 14 },
    { header: 'Slot', key: 'slot', width: 14 },
    { header: 'Pincode', key: 'pincode', width: 10 },
    { header: 'Items', key: 'items', width: 8 },
    { header: 'Item total (INR)', key: 'itemTotal', width: 16 },
    { header: 'Minimum order charge (INR)', key: 'minCharge', width: 24 },
    { header: 'Delivery charge (INR)', key: 'distanceCharge', width: 20 },
    { header: 'Waived (INR)', key: 'waived', width: 14 },
    { header: 'Grand total (INR)', key: 'grandTotal', width: 18 },
    { header: 'Amount paid (INR)', key: 'amountPaid', width: 18 },
    { header: 'Payment method', key: 'paymentMethod', width: 18 },
    { header: 'Payment status', key: 'paymentStatus', width: 16 },
    { header: 'Invoice', key: 'invoice', width: 18 },
  ];
  styleHeader(sheet);

  for (const order of orders) {
    sheet.addRow({
      orderNumber: order.orderNumber,
      placedAt: order.placedAt.toISOString(),
      status: order.status,
      customer: order.user.name,
      phone: order.user.phone,
      deliveryDate: order.deliveryDate?.toISOString().slice(0, 10) ?? '',
      slot: order.deliverySlot ?? '',
      pincode: order.deliveryPincode,
      items: order.items.reduce((count, item) => count + item.quantity, 0),
      itemTotal: rupees(order.itemTotalPaise),
      minCharge: rupees(order.minOrderChargePaise),
      distanceCharge: rupees(order.distanceChargePaise),
      waived: rupees(order.waivedChargePaise),
      grandTotal: rupees(order.grandTotalPaise),
      amountPaid: rupees(order.amountPaidPaise),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      invoice: order.invoice?.invoiceNumber ?? '',
    });
  }

  for (const key of ['itemTotal', 'minCharge', 'distanceCharge', 'waived', 'grandTotal', 'amountPaid']) {
    sheet.getColumn(key).numFmt = '#,##0.00';
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    fileName: `orders-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.xlsx`,
    rows: orders.length,
  };
}
