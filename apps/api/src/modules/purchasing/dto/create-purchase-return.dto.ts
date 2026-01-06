import { IsArray, IsDateString, IsNumberString, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CreatePurchaseReturnLineDto {
  @IsString()
  receiptLineId!: string;

  @IsNumberString()
  quantity!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePurchaseReturnDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  supplierCreditNoteId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReturnLineDto)
  lines!: CreatePurchaseReturnLineDto[];
}