import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';

export class GrniReportQueryDto {
  // YYYY-MM-DD
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  // YYYY-MM-DD
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  // default true (we'll enforce default in service)
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  onlyNonZero?: boolean;
}