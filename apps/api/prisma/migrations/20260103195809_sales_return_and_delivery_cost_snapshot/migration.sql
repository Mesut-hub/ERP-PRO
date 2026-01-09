-- AlterTable
ALTER TABLE "SalesDeliveryLine" ADD COLUMN     "lineCost" DECIMAL(18,2),
ADD COLUMN     "unitCost" DECIMAL(18,6);

-- CreateTable
CREATE TABLE "SalesReturn" (
    "id" TEXT NOT NULL,
    "documentNo" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "stockMoveId" TEXT,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "lineCost" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "SalesReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_documentNo_key" ON "SalesReturn"("documentNo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_stockMoveId_key" ON "SalesReturn"("stockMoveId");

-- CreateIndex
CREATE INDEX "SalesReturn_deliveryId_idx" ON "SalesReturn"("deliveryId");

-- CreateIndex
CREATE INDEX "SalesReturn_documentDate_idx" ON "SalesReturn"("documentDate");

-- CreateIndex
CREATE INDEX "SalesReturnLine_returnId_idx" ON "SalesReturnLine"("returnId");

-- CreateIndex
CREATE INDEX "SalesReturnLine_productId_idx" ON "SalesReturnLine"("productId");

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "SalesDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_stockMoveId_fkey" FOREIGN KEY ("stockMoveId") REFERENCES "StockMove"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnLine" ADD CONSTRAINT "SalesReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SalesReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnLine" ADD CONSTRAINT "SalesReturnLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnLine" ADD CONSTRAINT "SalesReturnLine_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
