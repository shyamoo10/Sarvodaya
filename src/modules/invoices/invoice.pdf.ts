import PDFDocument from 'pdfkit';
import type { InvoiceKind, PaymentMethod, PaymentStatus, ProductUnit } from '@prisma/client';

export type InvoicePdfData = {
  shop: { name: string; address: string; phone: string; gstNumber: string };
  invoice: { number: string; kind: InvoiceKind; issuedAt: Date };
  buyer: {
    name: string;
    phone: string;
    addressLines: string[];
    gstNumber: string | null;
  };
  order: {
    orderNumber: string;
    placedAt: Date;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
    deliveryDate: Date | null;
    deliverySlot: string | null;
  };
  items: {
    name: string;
    sku: string;
    quantity: number;
    unit: ProductUnit;
    unitPricePaise: number;
    lineTotalPaise: number;
  }[];
  money: {
    itemTotalPaise: number;
    minOrderChargePaise: number;
    distanceChargePaise: number;
    grandTotalPaise: number;
    waivedCharge: { label: string; amountPaise: number } | null;
  };
};

function money(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateText(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '—';
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  ONLINE: 'Online payment',
  CASH_ON_DELIVERY: 'Cash on delivery',
  CREDIT: 'Pay later (credit terms)',
};

/**
 * Builds the invoice PDF in memory.
 *
 * A buyer who gave a GST number gets a TAX INVOICE with both GST numbers printed;
 * everyone else gets a plain BILL with no GSTIN anywhere. Every charge stays its
 * own line, matching what the customer saw at checkout.
 */
export async function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const isTaxInvoice = data.invoice.kind === 'TAX_INVOICE';
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(18).text(data.shop.name, left, 50);
  doc.font('Helvetica').fontSize(9).fillColor('#444444');
  if (data.shop.address) doc.text(data.shop.address, left, doc.y + 2);
  if (data.shop.phone) doc.text(`Phone: ${data.shop.phone}`);
  if (data.shop.gstNumber) doc.text(`GSTIN: ${data.shop.gstNumber}`);
  doc.fillColor('#000000');

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(isTaxInvoice ? 'TAX INVOICE' : 'BILL', left + 250, 50, { width: right - left - 250, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(9)
    .text(`Invoice: ${data.invoice.number}`, { width: right - left - 250, align: 'right' })
    .text(`Date: ${dateText(data.invoice.issuedAt)}`, { width: right - left - 250, align: 'right' })
    .text(`Order: ${data.order.orderNumber}`, { width: right - left - 250, align: 'right' })
    .text(`Placed: ${dateText(data.order.placedAt)}`, { width: right - left - 250, align: 'right' });

  doc.moveDown(1.5);
  const billTop = Math.max(doc.y, 140);

  doc.font('Helvetica-Bold').fontSize(9).text('BILL TO', left, billTop);
  doc.font('Helvetica-Bold').fontSize(11).text(data.buyer.name, left, billTop + 14);
  doc.font('Helvetica').fontSize(9);
  doc.text(data.buyer.phone, left, doc.y);
  for (const line of data.buyer.addressLines) doc.text(line);
  // The buyer's GSTIN appears only when the buyer actually gave one.
  if (data.buyer.gstNumber) doc.font('Helvetica-Bold').text(`Buyer GSTIN: ${data.buyer.gstNumber}`);
  doc.font('Helvetica');

  doc.font('Helvetica-Bold').fontSize(9).text('DELIVERY', right - 200, billTop, {
    width: 200,
    align: 'right',
  });
  doc.font('Helvetica').fontSize(9);
  doc.text(
    `${dateText(data.order.deliveryDate)}${data.order.deliverySlot ? ` · ${data.order.deliverySlot}` : ''}`,
    { width: 200, align: 'right' },
  );
  doc.text(METHOD_LABELS[data.order.paymentMethod], { width: 200, align: 'right' });
  doc.text(`Payment: ${data.order.paymentStatus.replace('_', ' ').toLowerCase()}`, {
    width: 200,
    align: 'right',
  });

  doc.moveDown(2);
  const tableTop = doc.y + 10;
  const columns = { item: left, sku: left + 230, qty: left + 330, rate: left + 390, amount: right - 80 };

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('ITEM', columns.item, tableTop);
  doc.text('SKU', columns.sku, tableTop);
  doc.text('QTY', columns.qty, tableTop, { width: 50, align: 'right' });
  doc.text('RATE', columns.rate, tableTop, { width: 60, align: 'right' });
  doc.text('AMOUNT', columns.amount, tableTop, { width: 80, align: 'right' });

  doc
    .moveTo(left, tableTop + 14)
    .lineTo(right, tableTop + 14)
    .strokeColor('#999999')
    .stroke();

  let y = tableTop + 20;
  doc.font('Helvetica').fontSize(9);
  for (const item of data.items) {
    if (y > doc.page.height - 180) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.fillColor('#000000');
    doc.text(item.name.slice(0, 48), columns.item, y, { width: 220 });
    doc.fillColor('#555555').fontSize(8).text(item.sku, columns.sku, y, { width: 90 });
    doc.fillColor('#000000').fontSize(9);
    doc.text(`${item.quantity} ${item.unit.toLowerCase()}`, columns.qty, y, { width: 50, align: 'right' });
    doc.text(money(item.unitPricePaise), columns.rate, y, { width: 60, align: 'right' });
    doc.text(money(item.lineTotalPaise), columns.amount, y, { width: 80, align: 'right' });
    y += 18;
  }

  doc.moveTo(left, y + 4).lineTo(right, y + 4).strokeColor('#999999').stroke();
  y += 14;

  const totalRow = (label: string, value: string, bold = false): void => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
    doc.text(label, right - 250, y, { width: 150, align: 'right' });
    doc.text(value, right - 90, y, { width: 90, align: 'right' });
    y += bold ? 20 : 15;
  };

  totalRow('Item total', money(data.money.itemTotalPaise));
  totalRow('Minimum order charge', money(data.money.minOrderChargePaise));
  totalRow('Delivery charge', money(data.money.distanceChargePaise));
  if (data.money.waivedCharge && data.money.waivedCharge.amountPaise > 0) {
    totalRow(`${data.money.waivedCharge.label} waived`, `- ${money(data.money.waivedCharge.amountPaise)}`);
  }
  doc.moveTo(right - 250, y - 6).lineTo(right, y - 6).strokeColor('#999999').stroke();
  totalRow('Grand total', money(data.money.grandTotalPaise), true);

  doc.font('Helvetica').fontSize(8).fillColor('#666666');
  doc.text(
    isTaxInvoice
      ? 'Tax invoice issued against the GSTIN given by the buyer. Amounts are the prices frozen when the order was placed.'
      : 'Bill for a buyer without a GST number. Amounts are the prices frozen when the order was placed.',
    left,
    doc.page.height - 110,
    { width: right - left },
  );
  doc.text(
    'This is a computer generated document. For any question about this order, contact the shop with the order number.',
    { width: right - left },
  );

  doc.end();
  return done;
}
