import { IsArray, IsNumberString, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ReceivePoLineDto {
  @IsString()
  poLineId!: string;

  @IsNumberString()
  quantity!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReceivePoDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivePoLineDto)
  lines!: ReceivePoLineDto[];
}
