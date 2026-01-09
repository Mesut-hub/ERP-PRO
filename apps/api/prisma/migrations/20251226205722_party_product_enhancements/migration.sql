-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "contactPersonName" TEXT,
ADD COLUMN     "contactPersonTitle" TEXT,
ADD COLUMN     "creditLimit" DECIMAL(18,2),
ADD COLUMN     "creditRiskLevel" INTEGER,
ADD COLUMN     "defaultVatCode" "VatRateCode",
ADD COLUMN     "eInvoiceAlias" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "isEInvoiceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "swift" TEXT,
ADD COLUMN     "whatsappNumber" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "heightCm" DECIMAL(18,2),
ADD COLUMN     "hsCode" TEXT,
ADD COLUMN     "lengthCm" DECIMAL(18,2),
ADD COLUMN     "minStock" DECIMAL(18,4),
ADD COLUMN     "originCountry" TEXT,
ADD COLUMN     "priceCurrencyCode" TEXT,
ADD COLUMN     "purchasePrice" DECIMAL(18,2),
ADD COLUMN     "reorderPoint" DECIMAL(18,4),
ADD COLUMN     "salesPrice" DECIMAL(18,2),
ADD COLUMN     "trackLot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trackSerial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weightKg" DECIMAL(18,4),
ADD COLUMN     "widthCm" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "PartyContact" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "notes" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttachment" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "url" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyContact_partyId_idx" ON "PartyContact"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_code_key" ON "ProductCategory"("code");

-- CreateIndex
CREATE INDEX "ProductCategory_parentId_idx" ON "ProductCategory"("parentId");

-- CreateIndex
CREATE INDEX "ProductCategory_name_idx" ON "ProductCategory"("name");

-- CreateIndex
CREATE INDEX "ProductAttachment_productId_idx" ON "ProductAttachment"("productId");

-- CreateIndex
CREATE INDEX "Party_name_idx" ON "Party"("name");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_defaultVatCode_fkey" FOREIGN KEY ("defaultVatCode") REFERENCES "VatRate"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyContact" ADD CONSTRAINT "PartyContact_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_priceCurrencyCode_fkey" FOREIGN KEY ("priceCurrencyCode") REFERENCES "Currency"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttachment" ADD CONSTRAINT "ProductAttachment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
