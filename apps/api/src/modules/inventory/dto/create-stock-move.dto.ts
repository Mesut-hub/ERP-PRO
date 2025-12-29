import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
  IsNumberString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StockMoveType } from '@prisma/client';

class CreateStockMoveLineDto {
  @IsString()
  productId!: string;

  @IsString()
  unitId!: string;

  // decimals as strings
  @IsNumberString()
  quantity!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  lotNo?: string;

  @IsOptional()
  @IsString()
  serialNo?: string;
}

export class CreateStockMoveDto {
  @IsEnum(StockMoveType)
  type!: StockMoveType;

  @IsOptional()
  @IsString()
  fromWarehouseId?: string;

  @IsOptional()
  @IsString()
  toWarehouseId?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockMoveLineDto)
  lines!: CreateStockMoveLineDto[];
}