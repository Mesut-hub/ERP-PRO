import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class SetUserRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roleIds!: string[];
}