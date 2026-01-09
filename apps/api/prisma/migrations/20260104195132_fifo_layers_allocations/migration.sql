-- CreateEnum
CREATE TYPE "InventoryCostMethod" AS ENUM ('FIFO');

-- CreateTable
CREATE TABLE "InventoryFifoLayer" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "qtyIn" DECIMAL(18,4) NOT NULL,
    "qtyRemain" DECIMAL(18,4) NOT NULL,
    "unitCostBase" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryFifoLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryFifoAllocation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "issueSourceType" TEXT NOT NULL,
    "issueSourceId" TEXT NOT NULL,
    "issueSourceLineId" TEXT,
    "layerId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCostBase" DECIMAL(18,6) NOT NULL,
    "amountBase" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryFifoAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryValuationEntry" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "method" "InventoryCostMethod" NOT NULL DEFAULT 'FIFO',
    "quantityIn" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantityOut" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountBase" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryValuationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryFifoLayer_productId_warehouseId_receivedAt_idx" ON "InventoryFifoLayer"("productId", "warehouseId", "receivedAt");

-- CreateIndex
CREATE INDEX "InventoryFifoLayer_sourceType_sourceId_idx" ON "InventoryFifoLayer"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "InventoryFifoAllocation_productId_warehouseId_idx" ON "InventoryFifoAllocation"("productId", "warehouseId");

-- CreateIndex
CREATE INDEX "InventoryFifoAllocation_issueSourceType_issueSourceId_idx" ON "InventoryFifoAllocation"("issueSourceType", "issueSourceId");

-- CreateIndex
CREATE INDEX "InventoryFifoAllocation_layerId_idx" ON "InventoryFifoAllocation"("layerId");

-- CreateIndex
CREATE INDEX "InventoryValuationEntry_productId_warehouseId_createdAt_idx" ON "InventoryValuationEntry"("productId", "warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryValuationEntry_sourceType_sourceId_idx" ON "InventoryValuationEntry"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "InventoryFifoLayer" ADD CONSTRAINT "InventoryFifoLayer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryFifoLayer" ADD CONSTRAINT "InventoryFifoLayer_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryFifoAllocation" ADD CONSTRAINT "InventoryFifoAllocation_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "InventoryFifoLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryFifoAllocation" ADD CONSTRAINT "InventoryFifoAllocation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryFifoAllocation" ADD CONSTRAINT "InventoryFifoAllocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryValuationEntry" ADD CONSTRAINT "InventoryValuationEntry_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
