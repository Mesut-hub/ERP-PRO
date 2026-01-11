import { IsString, MinLength } from 'class-validator';

export class PeriodActionDto {
  @IsString()
  @MinLength(15)
  reason!: string;
}
