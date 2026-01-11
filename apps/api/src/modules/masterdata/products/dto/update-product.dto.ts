import { IsBoolean, IsEnum, IsNumberString, IsOptional, IsString, Length } from 'class-validator';
import { ProductType, VatRateCode } from '@prisma/client';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  hsCode?: string;

  @IsOptional()
  @IsString()
  originCountry?: string;

  @IsOptional()
  @IsString()
  baseUnitId?: string;

  @IsOptional()
  @IsEnum(VatRateCode)
  vatCode?: VatRateCode;

  @IsOptional()
  @IsNumberString()
  purchasePrice?: string;

  @IsOptional()
  @IsNumberString()
  salesPrice?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  priceCurrencyCode?: string;

  @IsOptional()
  @IsNumberString()
  minStock?: string;

  @IsOptional()
  @IsNumberString()
  reorderPoint?: string;

  @IsOptional()
  @IsNumberString()
  weightKg?: string;

  @IsOptional()
  @IsNumberString()
  lengthCm?: string;

  @IsOptional()
  @IsNumberString()
  widthCm?: string;

  @IsOptional()
  @IsNumberString()
  heightCm?: string;

  @IsOptional()
  @IsBoolean()
  trackLot?: boolean;

  @IsOptional()
  @IsBoolean()
  trackSerial?: boolean;

  @IsOptional()
  isActive?: boolean;
}
