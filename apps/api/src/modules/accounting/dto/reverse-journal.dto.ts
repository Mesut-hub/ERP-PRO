import { IsDateString, IsString, MinLength } from 'class-validator';

export class ReverseJournalDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  @MinLength(15)
  reason!: string;
}