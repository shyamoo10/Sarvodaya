import ExcelJS from 'exceljs';
import type { ProductUnit } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/http';
import { ErrorCode } from '../../config/error-codes';
import { UNIT_VALUES } from './catalog.schemas';

export type ImportRowError = {
  row: number;
  sku: string | null;
  field: string;
  message: string;
};

export type ImportReport = {
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  errors: ImportRowError[];
};

const MAX_ROWS = 5000;

/** Columns without a match in this list fall back to the canonical header name. */
const HEADER_ALIASES: Record<string, string> = {
  size: 'size_variant',
  variant: 'size_variant',
  sizevariant: 'size_variant',
  stocks: 'stock',
  qty: 'stock',
  quantity: 'stock',
  photo: 'photos',
  image: 'photos',
  image_url: 'photos',
  images: 'photos',
  category_path: 'category',
  cat: 'category',
};

const REQUIRED_COLUMNS = ['sku', 'name', 'category', 'brand', 'unit', 'price'] as const;

/** Reads a cell value as trimmed text regardless of how Excel stored it. */
function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;

  if (typeof record.text === 'string') return record.text.trim();
  if (Array.isArray(record.richText)) {
    const text = record.richText
      .map((part) =>
        typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join('');
    return text.trim() || null;
  }
  if (record.result !== undefined) return cellText(record.result);
  if (typeof record.hyperlink === 'string') return record.hyperlink.trim();

  return null;
}

function normalizeHeader(value: unknown): string {
  const text = cellText(value);
  if (!text) return '';
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parsePricePaise(text: string | null): { paise: number | null; error?: string } {
  if (!text) return { paise: null, error: 'price is required (in rupees, e.g. 345.50)' };
  const cleaned = text.replace(/[₹,\s]/g, '');
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    return { paise: null, error: 'price must be a positive number in rupees' };
  }
  if (value > 1_000_000) {
    return { paise: null, error: 'price looks too large (maximum ₹10,00,000 per unit)' };
  }
  return { paise: Math.round(value * 100) };
}

function parseStock(text: string | null): { stock: number; error?: string } {
  if (!text) return { stock: 0 };
  const value = Number(text.replace(/,/g, ''));
  if (!Number.isInteger(value) || value < 0) {
    return { stock: 0, error: 'stock must be a whole number (0 or more)' };
  }
  if (value > 1_000_000) {
    return { stock: 0, error: 'stock is too large (maximum 1,000,000)' };
  }
  return { stock: value };
}

function parsePhotos(text: string | null): { photos: string[]; error?: string } {
  if (!text) return { photos: [] };
  const photos = text
    .split(/[,;]/)
    .map((photo) => photo.trim())
    .filter((photo) => photo.length > 0);

  if (photos.length > 10) {
    return { photos: [], error: 'at most 10 photo URLs are allowed' };
  }
  for (const photo of photos) {
    if (!/^https?:\/\/\S+$/i.test(photo)) {
      return { photos: [], error: `photo URL "${photo}" must start with http:// or https://` };
    }
  }
  return { photos };
}

type CategoryLookup = {
  bySlug: Map<string, string>;
  byPath: Map<string, string>;
  byShortName: Map<string, string>;
};

async function buildCategoryLookup(): Promise<CategoryLookup> {
  const categories = await prisma.category.findMany({
    select: { id: true, name: true, slug: true, parentId: true },
  });
  const byId = new Map(categories.map((category) => [category.id, category]));
  const bySlug = new Map<string, string>();
  const byPath = new Map<string, string>();
  const byShortName = new Map<string, string>();
  const childNameCounts = new Map<string, number>();

  for (const category of categories) {
    const name = category.name.toLowerCase();
    bySlug.set(category.slug.toLowerCase(), category.id);

    if (category.parentId) {
      const parent = byId.get(category.parentId);
      if (parent) {
        byPath.set(`${parent.name.toLowerCase()} > ${name}`, category.id);
      }
      childNameCounts.set(name, (childNameCounts.get(name) ?? 0) + 1);
    } else {
      byPath.set(name, category.id);
    }
  }

  // A sub-category name may be used alone when it is not ambiguous.
  for (const category of categories) {
    if (category.parentId && childNameCounts.get(category.name.toLowerCase()) === 1) {
      byShortName.set(category.name.toLowerCase(), category.id);
    }
  }

  return { bySlug, byPath, byShortName };
}

function resolveCategory(lookup: CategoryLookup, text: string | null): string | null {
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/\s*>\s*/g, ' > ').trim();
  return (
    lookup.bySlug.get(normalized) ??
    lookup.byPath.get(normalized) ??
    lookup.byShortName.get(normalized) ??
    null
  );
}

function toUnitEnum(value: string): ProductUnit {
  return value.toUpperCase() as ProductUnit;
}

/**
 * Imports a workbook where the first sheet has a header row followed by products.
 *
 * Valid rows are saved and invalid rows are reported individually, so one bad row
 * never blocks the rest of the sheet. Rows are matched by SKU: re-running the same
 * sheet updates products instead of creating duplicates. Hidden products stay
 * hidden after an update.
 */
export async function importProductsFromWorkbook(buffer: Buffer): Promise<ImportReport> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs pins an older Buffer type than @types/node 22; both describe the
    // same value at runtime, so the cast is safe.
    const xlsx = workbook.xlsx as unknown as { load: (data: Buffer) => Promise<unknown> };
    await xlsx.load(buffer);
  } catch {
    throw new ApiError(
      400,
      ErrorCode.INVALID_IMPORT_FILE,
      'The uploaded file could not be read as an .xlsx workbook',
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.actualRowCount === 0) {
    throw new ApiError(400, ErrorCode.INVALID_IMPORT_FILE, 'The workbook has no rows');
  }

  const columnIndex = new Map<string, number>();
  let headerRowNumber = 0;

  for (let rowNumber = 1; rowNumber <= Math.min(sheet.actualRowCount, 5); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const found = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = normalizeHeader(cell.value);
      if (!header) return;
      const canonical = HEADER_ALIASES[header] ?? header;
      if (!found.has(canonical)) found.set(canonical, colNumber);
    });
    if (REQUIRED_COLUMNS.every((column) => found.has(column))) {
      headerRowNumber = rowNumber;
      for (const [key, value] of found) columnIndex.set(key, value);
      break;
    }
  }

  if (headerRowNumber === 0) {
    throw new ApiError(
      400,
      ErrorCode.INVALID_IMPORT_FILE,
      `The header row must contain these columns: ${REQUIRED_COLUMNS.join(', ')}`,
    );
  }

  if (sheet.actualRowCount - headerRowNumber > MAX_ROWS) {
    throw new ApiError(
      400,
      ErrorCode.INVALID_IMPORT_FILE,
      `Import at most ${MAX_ROWS} products per file`,
    );
  }

  const lookup = await buildCategoryLookup();
  const errors: ImportRowError[] = [];
  let totalRows = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;

  const read = (rowNumber: number, column: string): string | null => {
    const index = columnIndex.get(column);
    if (!index) return null;
    return cellText(sheet.getRow(rowNumber).getCell(index).value);
  };

  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const values = Array.from(columnIndex.keys()).map((column) => read(rowNumber, column));
    if (values.every((value) => value === null || value === '')) continue;

    totalRows += 1;

    const rowErrors: { field: string; message: string }[] = [];
    const skuRaw = read(rowNumber, 'sku');
    const sku = skuRaw ? skuRaw.toUpperCase() : null;

    if (!sku) {
      rowErrors.push({ field: 'sku', message: 'sku is required' });
    } else if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(sku)) {
      rowErrors.push({
        field: 'sku',
        message: 'sku may only contain letters, numbers, dot, dash, slash and underscore (max 40)',
      });
    }

    const name = read(rowNumber, 'name');
    if (!name) rowErrors.push({ field: 'name', message: 'name is required' });
    else if (name.length < 2 || name.length > 160) {
      rowErrors.push({ field: 'name', message: 'name must be between 2 and 160 characters' });
    }

    const brand = read(rowNumber, 'brand');
    if (!brand) rowErrors.push({ field: 'brand', message: 'brand is required' });
    else if (brand.length > 80) {
      rowErrors.push({ field: 'brand', message: 'brand must be 80 characters or fewer' });
    }

    const unitText = read(rowNumber, 'unit');
    const unit = unitText ? unitText.toLowerCase() : null;
    if (!unit) {
      rowErrors.push({ field: 'unit', message: `unit is required (${UNIT_VALUES.join(', ')})` });
    } else if (!(UNIT_VALUES as readonly string[]).includes(unit)) {
      rowErrors.push({ field: 'unit', message: `unit must be one of: ${UNIT_VALUES.join(', ')}` });
    }

    const price = parsePricePaise(read(rowNumber, 'price'));
    if (price.error) rowErrors.push({ field: 'price', message: price.error });

    const stock = parseStock(read(rowNumber, 'stock'));
    if (stock.error) rowErrors.push({ field: 'stock', message: stock.error });

    const photos = parsePhotos(read(rowNumber, 'photos'));
    if (photos.error) rowErrors.push({ field: 'photos', message: photos.error });

    const categoryText = read(rowNumber, 'category');
    const categoryId = resolveCategory(lookup, categoryText);
    if (!categoryText) {
      rowErrors.push({
        field: 'category',
        message: 'category is required (use "Parent > Child" for a sub-category)',
      });
    } else if (!categoryId) {
      rowErrors.push({
        field: 'category',
        message: `unknown category "${categoryText}". Create it first or write "Parent > Child"`,
      });
    }

    const sizeVariant = read(rowNumber, 'size_variant');
    if (sizeVariant && sizeVariant.length > 80) {
      rowErrors.push({ field: 'size_variant', message: 'size_variant must be 80 characters or fewer' });
    }

    const description = read(rowNumber, 'description');
    if (description && description.length > 1000) {
      rowErrors.push({ field: 'description', message: 'description must be 1000 characters or fewer' });
    }

    if (rowErrors.length > 0 || !sku || !name || !brand || !unit || !categoryId || !price.paise) {
      failed += 1;
      for (const rowError of rowErrors) {
        errors.push({ row: rowNumber, sku, field: rowError.field, message: rowError.message });
      }
      continue;
    }

    try {
      const exists = await prisma.product.findUnique({ where: { sku }, select: { id: true } });
      const fields = {
        name,
        brand,
        description: description ?? null,
        sizeVariant: sizeVariant ?? null,
        unit: toUnitEnum(unit),
        pricePaise: price.paise,
        stockQuantity: stock.stock,
        photos: photos.photos,
        categoryId,
      };

      await prisma.product.upsert({
        where: { sku },
        create: { sku, ...fields },
        update: fields,
      });

      if (exists) updated += 1;
      else created += 1;
    } catch {
      failed += 1;
      errors.push({
        row: rowNumber,
        sku,
        field: 'row',
        message: 'This row could not be saved. Check the values and try again.',
      });
    }
  }

  return { totalRows, created, updated, failed, errors };
}
