import { IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  code!: string; // "SALES", "ACCOUNTING"

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}