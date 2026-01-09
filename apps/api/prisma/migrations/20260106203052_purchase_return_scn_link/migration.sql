/*
  Warnings:

  - A unique constraint covering the columns `[supplierCreditNoteId]` on the table `PurchaseReturn` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_supplierCreditNoteId_key" ON "PurchaseReturn"("supplierCreditNoteId");
