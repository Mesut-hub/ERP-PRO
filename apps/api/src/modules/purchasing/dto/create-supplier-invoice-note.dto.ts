import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
  IsNumberString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceKind } from '@prisma/client';

class SupplierInvoiceLineDto {
  @IsString()
  description!: string;

  @IsNumberString()
  quantity!: string;

  @IsNumberString()
  unitPrice!: string;

  @IsString()
  vatCode!: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  poLineId?: string;
}

export class CreateSupplierInvoiceNoteDto {
  @IsEnum(InvoiceKind)
  kind!: InvoiceKind; // CREDIT_NOTE or DEBIT_NOTE

  @IsString()
  noteOfId!: string;

  @IsString()
  @MinLength(15)
  reason!: string;

  @IsOptional()
  @IsString()
  documentDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceLineDto)
  lines!: SupplierInvoiceLineDto[];
}
