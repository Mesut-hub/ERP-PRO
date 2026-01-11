import { IsDateString, IsNumberString, IsString, Length } from 'class-validator';

export class CreateExchangeRateDto {
  @IsString()
  @Length(3, 3)
  fromCode!: string;

  @IsString()
  @Length(3, 3)
  toCode!: string;

  // send as string to preserve precision: "35.12345678"
  @IsNumberString()
  rate!: string;

  @IsDateString()
  rateDate!: string; // ISO date
}
