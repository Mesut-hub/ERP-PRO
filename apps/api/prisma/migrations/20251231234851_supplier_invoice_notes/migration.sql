/*
  Warnings:

  - You are about to drop the column `notes` on the `SupplierInvoice` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SupplierInvoice" DROP COLUMN "notes",
ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'INVOICE',
ADD COLUMN     "noteOfId" TEXT,
ADD COLUMN     "noteReason" TEXT;

-- CreateIndex
CREATE INDEX "SupplierInvoice_kind_idx" ON "SupplierInvoice"("kind");

-- CreateIndex
CREATE INDEX "SupplierInvoice_noteOfId_idx" ON "SupplierInvoice"("noteOfId");

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_noteOfId_fkey" FOREIGN KEY ("noteOfId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
