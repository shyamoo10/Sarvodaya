import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { ErrorCode } from '../../config/error-codes';
import { ApiError } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import type { ReportQuery } from './report.schemas';

const METHOD_LABELS: Record<string, string> = {
  ONLINE: 'Online payment',
  CASH_ON_DELIVERY: 'Cash on delivery',
  CREDIT: 'Pay later',
};

function rupees(paise: number): number {
  return Number((paise / 100).toFixed(2));
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function resolveRange(query: ReportQuery): { from: Date; to: Date; label: string } {
  const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : new Date();
  const defaultFrom = new Date(to.getTime() - 29 * 86_400_000);
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : defaultFrom;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new ApiError(
      400,
      ErrorCode.REPORT_RANGE_INVALID,
      'Choose a valid date range: "from" must be on or before "to".',
      { from: query.from ?? null, to: query.to ?? null },
    );
  }

  return { from, to, label: `${dateOnly(from)} to ${dateOnly(to)}` };
}

function buildWhere(query: ReportQuery, from: Date, to: Date): Prisma.OrderWhereInput {
  return {
    placedAt: { gte: from, lt: new Date(to.getTime() + 86_400_000) },
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
  };
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * Sales report: one row per order with every money column, plus a summary sheet.
 * Amounts are rupees in the sheet (the API itself is always paise).
 */
export async function buildSalesReport(query: ReportQuery): Promise<{ buffer: Buffer; fileName: string }> {
  const { from, to, label } = resolveRange(query);
  const orders = await prisma.order.findMany({
    where: buildWhere(query, from, to),
    orderBy: [{ placedAt: 'asc' }],
    include: { user: { select: { name: true, phone: true } } },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sarvodaya API';

  const sheet = workbook.addWorksheet('Sales');
  sheet.columns = [
    { header: 'Order', key: 'order', width: 16 },
    { header: 'Placed', key: 'placed', width: 18 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Payment method', key: 'method', width: 18 },
    { header: 'Payment status', key: 'paymentStatus', width: 16 },
    { header: 'Item total (Rs)', key: 'itemTotal', width: 15, style: { numFmt: '#,##0.00' } },
    { header: 'Minimum order charge (Rs)', key: 'minOrder', width: 24, style: { numFmt: '#,##0.00' } },
    { header: 'Delivery charge (Rs)', key: 'delivery', width: 20, style: { numFmt: '#,##0.00' } },
    { header: 'Waived (Rs)', key: 'waived', width: 13, style: { numFmt: '#,##0.00' } },
    { header: 'Grand total (Rs)', key: 'total', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Paid (Rs)', key: 'paid', width: 13, style: { numFmt: '#,##0.00' } },
    { header: 'Due (Rs)', key: 'due', width: 13, style: { numFmt: '#,##0.00' } },
  ];
  styleHeader(sheet);

  for (const order of orders) {
    sheet.addRow({
      order: order.orderNumber,
      placed: order.placedAt.toISOString().slice(0, 16).replace('T', ' '),
      customer: order.user.name,
      phone: order.user.phone,
      status: order.status,
      method: METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod,
      paymentStatus: order.paymentStatus,
      itemTotal: rupees(order.itemTotalPaise),
      minOrder: rupees(order.minOrderChargePaise),
      delivery: rupees(order.distanceChargePaise),
      waived: rupees(order.waivedChargePaise),
      total: rupees(order.grandTotalPaise),
      paid: rupees(order.amountPaidPaise),
      due: rupees(Math.max(0, order.grandTotalPaise - order.amountPaidPaise)),
    });
  }

  const totals = orders.reduce(
    (sum, order) => {
      if (order.status === 'CANCELLED') return sum;
      sum.itemTotal += order.itemTotalPaise;
      sum.charges += order.minOrderChargePaise + order.distanceChargePaise;
      sum.total += order.grandTotalPaise;
      sum.paid += order.amountPaidPaise;
      return sum;
    },
    { itemTotal: 0, charges: 0, total: 0, paid: 0 },
  );

  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Measure', key: 'label', width: 32 },
    { header: 'Value', key: 'value', width: 22 },
  ];
  styleHeader(summary);
  summary.addRow({ label: 'Period', value: label });
  summary.addRow({ label: 'Orders', value: orders.length });
  summary.addRow({
    label: 'Cancelled orders',
    value: orders.filter((order) => order.status === 'CANCELLED').length,
  });
  summary.addRow({ label: 'Item total (Rs)', value: rupees(totals.itemTotal) });
  summary.addRow({ label: 'Charges (Rs)', value: rupees(totals.charges) });
  summary.addRow({ label: 'Grand total (Rs)', value: rupees(totals.total) });
  summary.addRow({ label: 'Paid (Rs)', value: rupees(totals.paid) });
  summary.addRow({ label: 'Outstanding (Rs)', value: rupees(Math.max(0, totals.total - totals.paid)) });
  summary.addRow({ label: 'Report generated', value: new Date().toISOString() });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer as ArrayBuffer),
    fileName: `sarvodaya-sales-${dateOnly(from)}-to-${dateOnly(to)}.xlsx`,
  };
}

/** Order report at line level: one row per item sold in the period. */
export async function buildOrdersReport(
  query: ReportQuery,
): Promise<{ buffer: Buffer; fileName: string }> {
  const { from, to, label } = resolveRange(query);
  const orders = await prisma.order.findMany({
    where: buildWhere(query, from, to),
    orderBy: [{ placedAt: 'asc' }],
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      user: { select: { name: true, phone: true } },
    },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sarvodaya API';

  const sheet = workbook.addWorksheet('Order items');
  sheet.columns = [
    { header: 'Order', key: 'order', width: 16 },
    { header: 'Placed', key: 'placed', width: 18 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Product', key: 'product', width: 38 },
    { header: 'Qty', key: 'quantity', width: 10 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Rate (Rs)', key: 'rate', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Amount (Rs)', key: 'amount', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Applied price rule', key: 'rule', width: 30 },
  ];
  styleHeader(sheet);

  for (const order of orders) {
    for (const item of order.items) {
      sheet.addRow({
        order: order.orderNumber,
        placed: order.placedAt.toISOString().slice(0, 16).replace('T', ' '),
        status: order.status,
        customer: order.user.name,
        sku: item.sku,
        product: item.name,
        quantity: item.quantity,
        unit: item.unit.toLowerCase(),
        rate: rupees(item.unitPricePaise),
        amount: rupees(item.lineTotalPaise),
        rule: item.appliedRuleLabel,
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer as ArrayBuffer),
    fileName: `sarvodaya-orders-${dateOnly(from)}-to-${dateOnly(to)}.xlsx`,
  };
}

export function periodLabel(query: ReportQuery): string {
  return resolveRange(query).label;
}
