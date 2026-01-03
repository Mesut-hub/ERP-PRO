import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VatRateCode } from '@prisma/client';

class CreateSupplierInvoiceLineDto {

  @IsOptional()
  @IsString()
  poLineId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsString()
  description!: string;

  @IsNumberString()
  quantity!: string;

  @IsNumberString()
  unitPrice!: string;

  @IsEnum(VatRateCode)
  vatCode!: VatRateCode;
}

export class CreateSupplierInvoiceDto {
  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  poId?: string;

  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  @IsOptional()
  @IsNumberString()
  exchangeRateToBase?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierInvoiceLineDto)
  lines!: CreateSupplierInvoiceLineDto[];
}