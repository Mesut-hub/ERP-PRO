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

class CreatePoLineDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  @IsNumberString()
  quantity!: string;

  @IsNumberString()
  unitPrice!: string;

  @IsEnum(VatRateCode)
  vatCode!: VatRateCode;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePoDto {
  @IsString()
  supplierId!: string;

  @IsString()
  warehouseId!: string;

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
  @Type(() => CreatePoLineDto)
  lines!: CreatePoLineDto[];
}
