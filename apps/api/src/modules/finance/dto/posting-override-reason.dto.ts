import { IsString, MinLength } from 'class-validator';

export class PostingOverrideReasonDto {
  @IsString()
  @MinLength(15)
  reason!: string;
}