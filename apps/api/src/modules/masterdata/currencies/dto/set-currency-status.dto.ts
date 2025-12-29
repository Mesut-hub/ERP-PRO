import { IsBoolean } from 'class-validator';

export class SetCurrencyStatusDto {
  @IsBoolean()
  isActive!: boolean;
}