/*
  Warnings:

  - Made the column `lineSubtotal` on table `PurchaseReceiptLine` required. This step will fail if there are existing NULL values in that column.
  - Made the column `poLineId` on table `PurchaseReceiptLine` required. This step will fail if there are existing NULL values in that column.
  - Made the column `unitPrice` on table `PurchaseReceiptLine` required. This step will fail if there are existing NULL values in that column.
  - Made the column `vatCode` on table `PurchaseReceiptLine` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "PurchaseReceiptLine" ALTER COLUMN "lineSubtotal" SET NOT NULL,
ALTER COLUMN "poLineId" SET NOT NULL,
ALTER COLUMN "unitPrice" SET NOT NULL,
ALTER COLUMN "vatCode" SET NOT NULL;
