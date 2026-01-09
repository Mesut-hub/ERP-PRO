-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "sequenceCode" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentSequence_sequenceCode_idx" ON "DocumentSequence"("sequenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_sequenceCode_periodKey_key" ON "DocumentSequence"("sequenceCode", "periodKey");
