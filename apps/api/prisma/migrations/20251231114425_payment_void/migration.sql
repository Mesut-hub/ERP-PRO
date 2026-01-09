/*
  Warnings:

  - A unique constraint covering the columns `[voidOfId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "voidOfId" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_voidOfId_key" ON "Payment"("voidOfId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_voidOfId_fkey" FOREIGN KEY ("voidOfId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
