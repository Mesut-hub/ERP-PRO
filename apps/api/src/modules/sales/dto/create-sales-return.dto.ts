import {
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SalesReturnLineDto {
  @IsString()
  deliveryLineId!: string;

  @IsNumberString()
  quantity!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateSalesReturnDto {
  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsString()
  @MinLength(15)
  reason!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesReturnLineDto)
  lines!: SalesReturnLineDto[];
}
