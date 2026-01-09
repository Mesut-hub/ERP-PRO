-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "creditCheckedAt" TIMESTAMP(3),
ADD COLUMN     "creditExposureAtApproval" DECIMAL(18,2),
ADD COLUMN     "creditOverrideReason" TEXT;
