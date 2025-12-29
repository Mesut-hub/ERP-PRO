import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class SetRolePermissionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissionIds!: string[];
}