import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { createAdmin, signUpOrLogin } from './helpers';

export const IMPORT_HEADERS = [
  'sku',
  'name',
  'category',
  'brand',
  'size_variant',
  'unit',
  'price',
  'stock',
  'photos',
  'description',
];

/** Builds an .xlsx buffer the same way the shop owner would send one. */
export async function buildWorkbook(
  rows: Record<string, unknown>[],
  headers: string[] = IMPORT_HEADERS,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(headers.map((header) => (row[header] === undefined ? null : row[header])));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/** Creates Steel > TMT Bars and Cement > OPC Cement. */
export async function createCategoryFixture() {
  const steel = await prisma.category.create({
    data: { name: 'Steel', slug: 'steel', sortOrder: 1 },
  });
  const tmt = await prisma.category.create({
    data: { name: 'TMT Bars', slug: 'tmt-bars', parentId: steel.id, sortOrder: 1 },
  });
  const cement = await prisma.category.create({
    data: { name: 'Cement', slug: 'cement', sortOrder: 2 },
  });
  const opc = await prisma.category.create({
    data: { name: 'OPC Cement', slug: 'opc-cement', parentId: cement.id, sortOrder: 1 },
  });

  return { steel, tmt, cement, opc };
}

export function productData(overrides: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
  return {
    sku: 'STL-TMT-008',
    name: 'TATA Tiscon 8 mm TMT Bar',
    brand: 'TATA Tiscon',
    sizeVariant: '8 mm',
    unit: 'KG' as const,
    pricePaise: 6850,
    stockQuantity: 100,
    photos: ['https://example.com/tmt.jpg'],
    ...overrides,
  };
}

export async function loginAsAdmin(phone = '9999999999') {
  await createAdmin(phone);
  return signUpOrLogin(phone);
}
