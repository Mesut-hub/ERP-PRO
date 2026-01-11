import { IsOptional, IsString, MinLength } from 'class-validator';

export class PostingOverrideDto {
  /**
   * Required ONLY when posting requires fin.posting.override (i.e. locked/closed date).
   * Ignored otherwise.
   */
  @IsOptional()
  @IsString()
  @MinLength(15)
  reason?: string;
}
