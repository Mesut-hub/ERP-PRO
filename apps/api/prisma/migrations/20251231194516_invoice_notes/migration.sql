/*
  Warnings:

  - You are about to drop the column `notes` on the `CustomerInvoice` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- AlterTable
ALTER TABLE "CustomerInvoice" DROP COLUMN "notes",
ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'INVOICE',
ADD COLUMN     "noteOfId" TEXT,
ADD COLUMN     "noteReason" TEXT;

-- CreateIndex
CREATE INDEX "CustomerInvoice_noteOfId_idx" ON "CustomerInvoice"("noteOfId");

-- AddForeignKey
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_noteOfId_fkey" FOREIGN KEY ("noteOfId") REFERENCES "CustomerInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
