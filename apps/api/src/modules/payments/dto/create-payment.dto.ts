import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentDirection, PaymentMethod } from '@prisma/client';

class AllocationDto {
  @IsOptional()
  @IsString()
  customerInvoiceId?: string;

  @IsOptional()
  @IsString()
  supplierInvoiceId?: string;

  @IsNumberString()
  amount!: string;
}

export class CreatePaymentDto {
  @IsEnum(PaymentDirection)
  direction!: PaymentDirection;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsString()
  partyId!: string;

  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  @IsOptional()
  @IsNumberString()
  exchangeRateToBase?: string;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations?: AllocationDto[];
}