-- CreateTable
CREATE TABLE "InventoryCost" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "avgUnitCost" DECIMAL(18,6) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryCost_warehouseId_idx" ON "InventoryCost"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCost_productId_warehouseId_key" ON "InventoryCost"("productId", "warehouseId");

-- AddForeignKey
ALTER TABLE "InventoryCost" ADD CONSTRAINT "InventoryCost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCost" ADD CONSTRAINT "InventoryCost_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
