import { IsArray, IsDateString, IsNumberString, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class JournalLineDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumberString()
  debit!: string;

  @IsNumberString()
  credit!: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsNumberString()
  amountCurrency?: string;
}

export class CreateJournalDto {
  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}