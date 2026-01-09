-- AlterTable
ALTER TABLE "PurchaseReturn" ADD COLUMN     "supplierCreditNoteId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseReturn_supplierCreditNoteId_idx" ON "PurchaseReturn"("supplierCreditNoteId");

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_supplierCreditNoteId_fkey" FOREIGN KEY ("supplierCreditNoteId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
