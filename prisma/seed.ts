import 'dotenv/config';
import { AccountType, PrismaClient, ProductUnit } from '@prisma/client';
import { normalizePhone } from '../src/lib/phone';
import { seedPricingAndDelivery } from './pricing.seed';

const prisma = new PrismaClient();

/**
 * Seed script.
 *
 * The ONLY way an ADMIN account is created. Customers and contractors sign
 * themselves up through the OTP flow; they can never choose ADMIN.
 *
 * Safe to run repeatedly: it upserts by phone number.
 */
async function main(): Promise<void> {
  const adminPhone = normalizePhone(process.env.SEED_ADMIN_PHONE ?? '9999999999');
  const adminName = process.env.SEED_ADMIN_NAME ?? 'Sarvodaya Admin';
  const adminCompany = process.env.SEED_ADMIN_COMPANY ?? 'Sarvodaya Hardware';

  const admin = await prisma.user.upsert({
    where: { phone: adminPhone },
    update: {
      accountType: AccountType.ADMIN,
      name: adminName,
      companyName: adminCompany,
      isBlocked: false,
      blockedAt: null,
      blockedReason: null,
    },
    create: {
      phone: adminPhone,
      accountType: AccountType.ADMIN,
      name: adminName,
      companyName: adminCompany,
    },
  });

  console.log(`Seeded admin: ${admin.phone} (${admin.name})`);

  if (process.env.SEED_SAMPLE_USERS !== 'false') {
    const customer = await prisma.user.upsert({
      where: { phone: '9876543210' },
      update: {},
      create: {
        phone: '9876543210',
        accountType: AccountType.CUSTOMER,
        name: 'Ramesh Kumar',
      },
    });

    const contractor = await prisma.user.upsert({
      where: { phone: '9123456780' },
      update: {},
      create: {
        phone: '9123456780',
        accountType: AccountType.CONTRACTOR,
        name: 'Suresh Patil',
        companyName: 'Patil Constructions',
        gstNumber: '27ABCDE1234F1Z5',
      },
    });

    const customerAddresses = await prisma.address.count({ where: { userId: customer.id } });
    if (customerAddresses === 0) {
      await prisma.address.create({
        data: {
          userId: customer.id,
          label: 'Home',
          contactName: 'Ramesh Kumar',
          contactPhone: '9876543210',
          line1: '12, Shivaji Nagar',
          landmark: 'Near Ganesh Temple',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411005',
          latitude: 18.5204,
          longitude: 73.8567,
          isDefault: true,
        },
      });
    }

    const contractorSites = await prisma.projectSite.count({ where: { userId: contractor.id } });
    if (contractorSites === 0) {
      await prisma.projectSite.create({
        data: {
          userId: contractor.id,
          siteName: 'Green Meadows Phase 2',
          contactName: 'Suresh Patil',
          contactPhone: '9123456780',
          line1: 'Survey No. 48, Baner Road',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411045',
          latitude: 18.559,
          longitude: 73.7868,
          notes: 'Gate passes required before 9 AM.',
        },
      });
    }

    console.log(`Seeded sample customer: ${customer.phone} and contractor: ${contractor.phone}`);
  }

  if (process.env.SEED_SAMPLE_PRODUCTS !== 'false') {
    await seedCatalogue();
  }

  if (process.env.SEED_PRICING !== 'false') {
    const summary = await seedPricingAndDelivery(prisma);
    console.log(`Seeded pricing: ${summary}.`);
  }

  console.log('Seed complete.');
}

type CategorySeed = {
  name: string;
  slug: string;
  parentSlug?: string;
  sortOrder: number;
  description?: string;
};

const CATEGORY_SEED: CategorySeed[] = [
  { name: 'Steel', slug: 'steel', sortOrder: 1, description: 'TMT bars, structural steel and MS pipes' },
  { name: 'TMT Bars', slug: 'tmt-bars', parentSlug: 'steel', sortOrder: 1, description: 'Fe 500 and Fe 550D ribbed bars' },
  { name: 'Structural Steel', slug: 'structural-steel', parentSlug: 'steel', sortOrder: 2, description: 'Angles, channels and flats' },
  { name: 'MS Pipes & Tubes', slug: 'ms-pipes', parentSlug: 'steel', sortOrder: 3 },

  { name: 'Cement', slug: 'cement', sortOrder: 2, description: 'OPC, PPC and white cement' },
  { name: 'OPC Cement', slug: 'opc-cement', parentSlug: 'cement', sortOrder: 1 },
  { name: 'PPC Cement', slug: 'ppc-cement', parentSlug: 'cement', sortOrder: 2 },
  { name: 'White Cement', slug: 'white-cement', parentSlug: 'cement', sortOrder: 3 },

  { name: 'Paint', slug: 'paint', sortOrder: 3, description: 'Emulsions, enamels, primers and putty' },
  { name: 'Interior Emulsion', slug: 'interior-emulsion', parentSlug: 'paint', sortOrder: 1 },
  { name: 'Exterior Emulsion', slug: 'exterior-emulsion', parentSlug: 'paint', sortOrder: 2 },
  { name: 'Enamel & Wood Finish', slug: 'enamel-wood-finish', parentSlug: 'paint', sortOrder: 3 },
  { name: 'Primer & Putty', slug: 'primer-putty', parentSlug: 'paint', sortOrder: 4 },

  { name: 'Fasteners', slug: 'fasteners', sortOrder: 4, description: 'Nuts, bolts, screws, anchors and rivets' },
  { name: 'Nuts & Bolts', slug: 'nuts-bolts', parentSlug: 'fasteners', sortOrder: 1 },
  { name: 'Screws', slug: 'screws', parentSlug: 'fasteners', sortOrder: 2 },
  { name: 'Anchors', slug: 'anchors', parentSlug: 'fasteners', sortOrder: 3 },

  { name: 'Plumbing', slug: 'plumbing', sortOrder: 5, description: 'Pipes, fittings and taps' },
  { name: 'PVC Pipes & Fittings', slug: 'pvc-pipes-fittings', parentSlug: 'plumbing', sortOrder: 1 },
  { name: 'CPVC Pipes', slug: 'cpvc-pipes', parentSlug: 'plumbing', sortOrder: 2 },
  { name: 'Taps & Mixers', slug: 'taps-mixers', parentSlug: 'plumbing', sortOrder: 3 },
];

type ProductSeed = {
  sku: string;
  name: string;
  brand: string;
  sizeVariant: string;
  unit: ProductUnit;
  pricePaise: number;
  stockQuantity: number;
  categorySlug: string;
  description?: string;
};

const PRODUCT_SEED: ProductSeed[] = [
  // Steel - TMT bars
  { sku: 'STL-TMT-008', name: 'TATA Tiscon 550D TMT Bar', brand: 'TATA Tiscon', sizeVariant: '8 mm', unit: ProductUnit.KG, pricePaise: 6850, stockQuantity: 2400, categorySlug: 'tmt-bars', description: 'Fe 550D ribbed bar for slabs, columns and beams' },
  { sku: 'STL-TMT-010', name: 'JSW Neosteel TMT Bar', brand: 'JSW', sizeVariant: '10 mm', unit: ProductUnit.KG, pricePaise: 6675, stockQuantity: 1800, categorySlug: 'tmt-bars' },
  { sku: 'STL-TMT-012', name: 'TATA Tiscon 550D TMT Bar', brand: 'TATA Tiscon', sizeVariant: '12 mm', unit: ProductUnit.KG, pricePaise: 6890, stockQuantity: 3000, categorySlug: 'tmt-bars' },
  { sku: 'STL-TMT-016', name: 'JSW Neosteel TMT Bar', brand: 'JSW', sizeVariant: '16 mm', unit: ProductUnit.KG, pricePaise: 6620, stockQuantity: 900, categorySlug: 'tmt-bars' },
  { sku: 'STL-TMT-020', name: 'SAIL TMT Bar', brand: 'SAIL', sizeVariant: '20 mm', unit: ProductUnit.KG, pricePaise: 6550, stockQuantity: 0, categorySlug: 'tmt-bars', description: 'Currently out of stock, restocking weekly' },

  // Steel - structural
  { sku: 'STL-ANG-050', name: 'MS Angle', brand: 'Sarvodaya', sizeVariant: '50 x 50 x 6 mm', unit: ProductUnit.KG, pricePaise: 6200, stockQuantity: 320, categorySlug: 'structural-steel' },
  { sku: 'STL-CHN-100', name: 'MS Channel', brand: 'Sarvodaya', sizeVariant: '100 x 50 mm', unit: ProductUnit.KG, pricePaise: 6350, stockQuantity: 180, categorySlug: 'structural-steel' },
  { sku: 'STL-FLT-025', name: 'MS Flat Bar', brand: 'Sarvodaya', sizeVariant: '25 x 5 mm', unit: ProductUnit.KG, pricePaise: 6100, stockQuantity: 240, categorySlug: 'structural-steel' },

  // Steel - pipes
  { sku: 'STL-PIP-1IN', name: 'MS Round Pipe', brand: 'Tata Structura', sizeVariant: '1 inch', unit: ProductUnit.KG, pricePaise: 7100, stockQuantity: 150, categorySlug: 'ms-pipes' },
  { sku: 'STL-PIP-2IN', name: 'MS Round Pipe', brand: 'Tata Structura', sizeVariant: '2 inch', unit: ProductUnit.KG, pricePaise: 7150, stockQuantity: 90, categorySlug: 'ms-pipes' },

  // Cement
  { sku: 'CEM-ULT-OPC53', name: 'UltraTech OPC 53 Grade Cement', brand: 'UltraTech', sizeVariant: '50 kg bag', unit: ProductUnit.BAG, pricePaise: 41000, stockQuantity: 600, categorySlug: 'opc-cement' },
  { sku: 'CEM-ULT-PPC', name: 'UltraTech PPC Cement', brand: 'UltraTech', sizeVariant: '50 kg bag', unit: ProductUnit.BAG, pricePaise: 39500, stockQuantity: 720, categorySlug: 'ppc-cement' },
  { sku: 'CEM-ACC-PPC', name: 'ACC Gold PPC Cement', brand: 'ACC', sizeVariant: '50 kg bag', unit: ProductUnit.BAG, pricePaise: 39000, stockQuantity: 480, categorySlug: 'ppc-cement' },
  { sku: 'CEM-BIR-WHT', name: 'Birla White Cement', brand: 'Birla White', sizeVariant: '40 kg bag', unit: ProductUnit.BAG, pricePaise: 115000, stockQuantity: 60, categorySlug: 'white-cement' },

  // Paint
  { sku: 'PNT-AP-TRC20', name: 'Asian Paints Tractor Emulsion', brand: 'Asian Paints', sizeVariant: '20 L pack', unit: ProductUnit.LITRE, pricePaise: 430000, stockQuantity: 35, categorySlug: 'interior-emulsion' },
  { sku: 'PNT-AP-ROY10', name: 'Asian Paints Royale Aspira', brand: 'Asian Paints', sizeVariant: '10 L pack', unit: ProductUnit.LITRE, pricePaise: 615000, stockQuantity: 22, categorySlug: 'interior-emulsion' },
  { sku: 'PNT-AP-APX20', name: 'Asian Paints Apex Ultima', brand: 'Asian Paints', sizeVariant: '20 L pack', unit: ProductUnit.LITRE, pricePaise: 780000, stockQuantity: 18, categorySlug: 'exterior-emulsion' },
  { sku: 'PNT-BG-WTH20', name: 'Berger WeatherCoat Long Life', brand: 'Berger', sizeVariant: '20 L pack', unit: ProductUnit.LITRE, pricePaise: 705000, stockQuantity: 12, categorySlug: 'exterior-emulsion' },
  { sku: 'PNT-BG-LUX4', name: 'Berger Luxol High Gloss Enamel', brand: 'Berger', sizeVariant: '4 L pack', unit: ProductUnit.LITRE, pricePaise: 128000, stockQuantity: 40, categorySlug: 'enamel-wood-finish' },
  { sku: 'PNT-AP-WTP1', name: 'Asian Paints WoodTech PU', brand: 'Asian Paints', sizeVariant: '1 L pack', unit: ProductUnit.LITRE, pricePaise: 78500, stockQuantity: 25, categorySlug: 'enamel-wood-finish' },
  { sku: 'PNT-AP-PRM20', name: 'Asian Paints Exterior Primer', brand: 'Asian Paints', sizeVariant: '20 L pack', unit: ProductUnit.LITRE, pricePaise: 345000, stockQuantity: 15, categorySlug: 'primer-putty' },
  { sku: 'PNT-BIR-PUT40', name: 'Birla White Wall Care Putty', brand: 'Birla White', sizeVariant: '40 kg bag', unit: ProductUnit.BAG, pricePaise: 125000, stockQuantity: 260, categorySlug: 'primer-putty' },

  // Fasteners
  { sku: 'FST-GIB-M12', name: 'GI Hex Bolt with Nut', brand: 'Sarvodaya', sizeVariant: 'M12 x 75 mm, pack of 25', unit: ProductUnit.BOX, pricePaise: 78500, stockQuantity: 75, categorySlug: 'nuts-bolts' },
  { sku: 'FST-NUT-M10', name: 'MS Nut & Bolt Set', brand: 'Sarvodaya', sizeVariant: 'M10 x 50 mm, pack of 50', unit: ProductUnit.BOX, pricePaise: 62000, stockQuantity: 110, categorySlug: 'nuts-bolts' },
  { sku: 'FST-SCR-025', name: 'Self Drilling Screw', brand: 'Sarvodaya', sizeVariant: '25 mm, pack of 100', unit: ProductUnit.BOX, pricePaise: 24500, stockQuantity: 200, categorySlug: 'screws' },
  { sku: 'FST-RVT-004', name: 'Aluminium Pop Rivet', brand: 'Sarvodaya', sizeVariant: '4 mm, pack of 100', unit: ProductUnit.BOX, pricePaise: 18000, stockQuantity: 0, categorySlug: 'screws' },
  { sku: 'FST-ANC-010', name: 'Anchor Fastener', brand: 'Hilti', sizeVariant: '10 mm', unit: ProductUnit.PIECE, pricePaise: 3200, stockQuantity: 500, categorySlug: 'anchors' },

  // Plumbing
  { sku: 'PLB-SUP-PVC4', name: 'Supreme PVC Pipe', brand: 'Supreme', sizeVariant: '4 inch x 3 m', unit: ProductUnit.PIECE, pricePaise: 89000, stockQuantity: 80, categorySlug: 'pvc-pipes-fittings' },
  { sku: 'PLB-SUP-ELB4', name: 'Supreme PVC Elbow', brand: 'Supreme', sizeVariant: '4 inch', unit: ProductUnit.PIECE, pricePaise: 9500, stockQuantity: 240, categorySlug: 'pvc-pipes-fittings' },
  { sku: 'PLB-AST-CP1', name: 'Astral CPVC Pipe', brand: 'Astral', sizeVariant: '1 inch x 3 m', unit: ProductUnit.PIECE, pricePaise: 42500, stockQuantity: 65, categorySlug: 'cpvc-pipes' },
  { sku: 'PLB-ASH-CP75', name: 'Ashirvad CPVC Pipe', brand: 'Ashirvad', sizeVariant: '3/4 inch x 3 m', unit: ProductUnit.PIECE, pricePaise: 31500, stockQuantity: 48, categorySlug: 'cpvc-pipes' },
  { sku: 'PLB-JQ-BSM', name: 'Jaquar Single Lever Basin Mixer', brand: 'Jaquar', sizeVariant: 'Chrome', unit: ProductUnit.PIECE, pricePaise: 485000, stockQuantity: 14, categorySlug: 'taps-mixers' },
  { sku: 'PLB-JQ-ANG', name: 'Jaquar Angle Valve', brand: 'Jaquar', sizeVariant: '15 mm', unit: ProductUnit.PIECE, pricePaise: 62000, stockQuantity: 120, categorySlug: 'taps-mixers' },
];

/**
 * Seeds the catalogue. Idempotent: categories are matched by slug and products by
 * SKU, and existing products are never overwritten so prices edited by the shop
 * owner survive a re-run.
 */
async function seedCatalogue(): Promise<void> {
  const categoryIds = new Map<string, string>();

  for (const category of CATEGORY_SEED) {
    const parentId = category.parentSlug ? (categoryIds.get(category.parentSlug) ?? null) : null;
    if (category.parentSlug && !parentId) {
      throw new Error(`Seed category ${category.slug} references unknown parent ${category.parentSlug}`);
    }

    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        name: category.name,
        slug: category.slug,
        description: category.description ?? null,
        parentId,
        sortOrder: category.sortOrder,
      },
    });
    categoryIds.set(category.slug, row.id);
  }

  let created = 0;
  let existing = 0;

  for (const product of PRODUCT_SEED) {
    const categoryId = categoryIds.get(product.categorySlug);
    if (!categoryId) {
      throw new Error(`Seed product ${product.sku} references unknown category ${product.categorySlug}`);
    }

    const found = await prisma.product.findUnique({ where: { sku: product.sku }, select: { id: true } });
    await prisma.product.upsert({
      where: { sku: product.sku },
      // Never overwrite a price or stock level the owner may have changed.
      update: {},
      create: {
        sku: product.sku,
        name: product.name,
        description: product.description ?? null,
        brand: product.brand,
        sizeVariant: product.sizeVariant,
        unit: product.unit,
        pricePaise: product.pricePaise,
        stockQuantity: product.stockQuantity,
        photos: [`https://placehold.co/600x400/png?text=${encodeURIComponent(product.brand)}`],
        categoryId,
      },
    });

    if (found) existing += 1;
    else created += 1;
  }

  console.log(
    `Seeded catalogue: ${CATEGORY_SEED.length} categories, ${created} new products, ${existing} already present.`,
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
