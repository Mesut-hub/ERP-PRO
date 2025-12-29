import { IsOptional, IsString, MinLength } from 'class-validator';

export class ApproveSalesOrderDto {
  @IsOptional()
  @IsString()
  @MinLength(15)
  reason?: string;
}