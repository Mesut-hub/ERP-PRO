import { IsArray, IsNumberString, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class DeliverLineDto {
  @IsString()
  soLineId!: string;

  @IsNumberString()
  quantity!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DeliverSalesOrderDto {
  @IsOptional()
  @IsString()
  notes?: string;

  // NEW: optional explicit document date (ISO string or yyyy-mm-dd)
  @IsOptional()
  @IsString()
  documentDate?: string;

  // NEW: optional posting lock override reason (only used if lock requires it)
  @IsOptional()
  @IsString()
  overrideReason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliverLineDto)
  lines!: DeliverLineDto[];
}
