-- AlterTable
ALTER TABLE "PurchaseReceiptLine" ADD COLUMN     "lineSubtotal" DECIMAL(18,2),
ADD COLUMN     "poLineId" TEXT,
ADD COLUMN     "unitPrice" DECIMAL(18,4),
ADD COLUMN     "vatCode" "VatRateCode";

-- AlterTable
ALTER TABLE "SupplierInvoiceLine" ADD COLUMN     "poLineId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseReceiptLine_poLineId_idx" ON "PurchaseReceiptLine"("poLineId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_poLineId_idx" ON "SupplierInvoiceLine"("poLineId");
