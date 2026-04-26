-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'material',
    "unit" TEXT,
    "defaultUnitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "vendorId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assembly" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assembly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyLine" (
    "id" TEXT NOT NULL,
    "assemblyId" TEXT NOT NULL,
    "productId" TEXT,
    "subAssemblyId" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitPriceOverrideCents" INTEGER,
    "description" TEXT,
    "category" TEXT,
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssemblyLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_kind_idx" ON "Product"("kind");

-- CreateIndex
CREATE INDEX "Assembly_category_idx" ON "Assembly"("category");

-- CreateIndex
CREATE INDEX "AssemblyLine_assemblyId_idx" ON "AssemblyLine"("assemblyId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyLine" ADD CONSTRAINT "AssemblyLine_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyLine" ADD CONSTRAINT "AssemblyLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyLine" ADD CONSTRAINT "AssemblyLine_subAssemblyId_fkey" FOREIGN KEY ("subAssemblyId") REFERENCES "Assembly"("id") ON DELETE SET NULL ON UPDATE CASCADE;
