import { Module } from '@nestjs/common';
import { ExchangeRatesService } from './exchange-rates.service';
import { ExchangeRatesController } from './exchange-rates.controller';

@Module({
  providers: [ExchangeRatesService],
  controllers: [ExchangeRatesController],
})
export class ExchangeRatesModule {}
