import { IsDateString, IsOptional } from 'class-validator';

export class CbrtSyncDto {
  @IsOptional()
  @IsDateString()
  rateDate?: string; // YYYY-MM-DD or full ISO; we normalize to Istanbul day key
}