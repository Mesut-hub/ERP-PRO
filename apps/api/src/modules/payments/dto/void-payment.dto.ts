import { IsDateString, IsString, MinLength } from 'class-validator';

export class VoidPaymentDto {
  @IsDateString()
  documentDate!: string;

  @IsString()
  @MinLength(15)
  reason!: string;
}
