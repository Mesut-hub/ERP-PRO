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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliverLineDto)
  lines!: DeliverLineDto[];
}
