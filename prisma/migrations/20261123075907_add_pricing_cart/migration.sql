-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'default',
    "shopLatitude" DOUBLE PRECISION NOT NULL,
    "shopLongitude" DOUBLE PRECISION NOT NULL,
    "minOrderAmountPaise" INTEGER NOT NULL DEFAULT 0,
    "minOrderChargePaise" INTEGER NOT NULL DEFAULT 0,
    "freeDeliveryAbovePaise" INTEGER,
    "freeDeliveryRadiusKm" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistanceSlab" (
    "id" UUID NOT NULL,
    "fromKm" DOUBLE PRECISION NOT NULL,
    "toKm" DOUBLE PRECISION,
    "chargePaise" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistanceSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceablePincode" (
    "pincode" VARCHAR(6) NOT NULL,
    "areaName" VARCHAR(120),
    "city" VARCHAR(80),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceablePincode_pkey" PRIMARY KEY ("pincode")
);

-- CreateTable
CREATE TABLE "ContractorPrice" (
    "id" UUID NOT NULL,
    "contractorId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkDiscount" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "productId" UUID,
    "categoryId" UUID,
    "minQuantity" INTEGER NOT NULL,
    "discountBps" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorRule" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "categoryId" UUID,
    "discountBps" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deliveryAddressId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DistanceSlab_fromKm_idx" ON "DistanceSlab"("fromKm");

-- CreateIndex
CREATE INDEX "ServiceablePincode_isActive_idx" ON "ServiceablePincode"("isActive");

-- CreateIndex
CREATE INDEX "ContractorPrice_productId_idx" ON "ContractorPrice"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorPrice_contractorId_productId_key" ON "ContractorPrice"("contractorId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkDiscount_name_key" ON "BulkDiscount"("name");

-- CreateIndex
CREATE INDEX "BulkDiscount_productId_idx" ON "BulkDiscount"("productId");

-- CreateIndex
CREATE INDEX "BulkDiscount_categoryId_idx" ON "BulkDiscount"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorRule_name_key" ON "ContractorRule"("name");

-- CreateIndex
CREATE INDEX "ContractorRule_categoryId_idx" ON "ContractorRule"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

-- CreateIndex
CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_productId_key" ON "CartItem"("cartId", "productId");

-- AddForeignKey
ALTER TABLE "ContractorPrice" ADD CONSTRAINT "ContractorPrice_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorPrice" ADD CONSTRAINT "ContractorPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkDiscount" ADD CONSTRAINT "BulkDiscount_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkDiscount" ADD CONSTRAINT "BulkDiscount_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorRule" ADD CONSTRAINT "ContractorRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_deliveryAddressId_fkey" FOREIGN KEY ("deliveryAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
