-- AlterTable
ALTER TABLE "SupplierInvoice" ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "SupplierInvoiceNote" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoiceNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierInvoiceNote_invoiceId_idx" ON "SupplierInvoiceNote"("invoiceId");

-- AddForeignKey
ALTER TABLE "SupplierInvoiceNote" ADD CONSTRAINT "SupplierInvoiceNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
