import { IsOptional, IsString, Matches } from 'class-validator';

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
}