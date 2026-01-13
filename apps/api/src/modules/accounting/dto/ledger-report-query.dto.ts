import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class LedgerReportQueryDto {
  @IsString()
  accountCode!: string;

  // YYYY-MM-DD
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  // YYYY-MM-DD
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  // Optional filters
  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  partyId?: string;

  // Pagination (skip/take now; cursor later)
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(1000)
  take?: number;
}