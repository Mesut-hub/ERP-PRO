import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class PostStockMoveDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  allowNegativeStockOverride?: boolean;
}