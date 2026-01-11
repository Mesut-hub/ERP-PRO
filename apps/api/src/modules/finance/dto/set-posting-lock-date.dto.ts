import { IsDateString, IsString, MinLength } from 'class-validator';

export class SetPostingLockDateDto {
  @IsDateString()
  value!: string;

  @IsString()
  @MinLength(15)
  reason!: string;
}
