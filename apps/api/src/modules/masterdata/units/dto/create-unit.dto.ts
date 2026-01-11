import { IsString } from 'class-validator';

export class CreateUnitDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;
}
