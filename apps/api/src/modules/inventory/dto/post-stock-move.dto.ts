import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class PostStockMoveDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  allowNegativeStockOverride?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(15)
  reason?: string;
}