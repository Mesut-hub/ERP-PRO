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

class CreateCustomerInvoiceLineDto {
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

  @IsOptional()
  @IsString()
  soLineId?: string;
}

export class CreateCustomerInvoiceDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  soId?: string;

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
  @Type(() => CreateCustomerInvoiceLineDto)
  lines!: CreateCustomerInvoiceLineDto[];
}
