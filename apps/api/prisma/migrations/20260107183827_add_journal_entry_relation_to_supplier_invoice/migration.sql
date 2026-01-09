/*
  Warnings:

  - A unique constraint covering the columns `[journalEntryId]` on the table `SupplierInvoice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "SupplierInvoice" ADD COLUMN     "journalEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_journalEntryId_key" ON "SupplierInvoice"("journalEntryId");

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
